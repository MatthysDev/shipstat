// Event storage for `shipstat-dashboard`: small on disk, small in memory.
//
// Layout of the data folder:
//   hot-<seq>.ndjson   the newest events, plain NDJSON, appended as they arrive (crash safe)
//   YYYY-MM-DD.br      older events, in brotli blocks of `blockSize` events, appended per day
//   index.ndjson       one line per block: { file, offset, length, count, seq }
//   LOCK               the pid of the process writing here
//
// Every event gets a sequence number in arrival order; read cursors are sequence numbers.
// Memory holds the hot events (at most one block), one or two decompressed blocks for reads,
// and the hashes of the newest ids to drop resent batches. Nothing else.
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

const brotli = promisify(zlib.brotliCompress);
const unbrotli = promisify(zlib.brotliDecompress);
// Quality 5 with a 16 MB window: measured ~50 bytes per event on realistic events (392 as
// plain JSON), ~5 µs of CPU per event. Higher qualities cost 2-40× more CPU for a few %.
const BROTLI = { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_LGWIN]: 24, [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT } };

const HOT = /^hot-(\d+)\.ndjson$/;
const SEGMENT = /^\d{4}-\d{2}-\d{2}\.br$/;

/** 53-bit string hash (cyrb53): ids are kept as numbers, not strings. */
export function hashId(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * The newest ids, to drop a batch the app sends again after a lost response. Two generations of
 * `size` hashes: memory stays flat whatever the volume. The dashboard also ignores duplicates.
 */
export class IdWindow {
  constructor(size = 200_000) {
    this.size = size;
    this.current = new Set();
    this.previous = new Set();
  }
  has(id) {
    const h = hashId(id);
    return this.current.has(h) || this.previous.has(h);
  }
  add(id) {
    if (this.current.size >= this.size) {
      this.previous = this.current;
      this.current = new Set();
    }
    this.current.add(hashId(id));
  }
}

const today = () => new Date().toISOString().slice(0, 10);

function idOf(line) {
  // Rows are written by this file with `id` first: avoid a full JSON.parse when possible.
  const m = /^\{"id":"((?:[^"\\]|\\.)*)"/.exec(line);
  if (m) return JSON.parse(`"${m[1]}"`);
  try {
    return JSON.parse(line).id;
  } catch {
    return undefined;
  }
}

/** Complete lines of an NDJSON text; a line cut by a hard kill is dropped. */
function completeLines(text) {
  const lines = text.split('\n');
  const last = lines.pop();
  if (last) {
    try {
      JSON.parse(last);
      lines.push(last);
    } catch {
      // Partial write.
    }
  }
  return lines.filter(Boolean);
}

function lockDir(dir) {
  const file = path.join(dir, 'LOCK');
  try {
    const pid = Number(fs.readFileSync(file, 'utf8'));
    if (pid && pid !== process.pid) {
      try {
        process.kill(pid, 0);
        throw Object.assign(new Error(`${dir} is in use by another shipstat-dashboard (pid ${pid}). Stop it first.`), { code: 'LOCKED' });
      } catch (e) {
        if (e.code === 'LOCKED') throw e;
        // That process is gone: take over.
      }
    }
  } catch (e) {
    if (e.code === 'LOCKED') throw e;
  }
  fs.writeFileSync(file, String(process.pid));
  const release = () => {
    process.off('exit', release);
    try {
      if (fs.readFileSync(file, 'utf8') === String(process.pid)) fs.unlinkSync(file);
    } catch {
      // Already gone.
    }
  };
  process.once('exit', release);
  return release;
}

/**
 * Opens (or creates) a data folder. `readOnly` neither locks nor repairs: for `dump` while a
 * server is running.
 */
export function openStore(dir, { blockSize = 10_000, retentionDays = 0, readOnly = false, windowSize = 200_000, log = () => {} } = {}) {
  dir = path.resolve(dir);
  if (!readOnly) fs.mkdirSync(dir, { recursive: true });
  const release = readOnly ? () => {} : lockDir(dir);
  const indexFile = path.join(dir, 'index.ndjson');

  // --- Load and repair -------------------------------------------------------------------
  let blocks = [];
  if (fs.existsSync(indexFile)) {
    for (const line of fs.readFileSync(indexFile, 'utf8').split('\n')) {
      if (!line) continue;
      try {
        const b = JSON.parse(line);
        if (b.file && b.count > 0) blocks.push(b);
      } catch {
        // Partial last line.
      }
    }
  }
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  if (!readOnly) {
    // A crash between writing a block and indexing it leaves bytes nobody points to.
    const ends = new Map();
    for (const b of blocks) ends.set(b.file, Math.max(ends.get(b.file) ?? 0, b.offset + b.length));
    for (const f of files.filter((n) => SEGMENT.test(n))) {
      const full = path.join(dir, f);
      const end = ends.get(f) ?? 0;
      if (end === 0) fs.unlinkSync(full);
      else if (fs.statSync(full).size > end) fs.truncateSync(full, end);
    }
    // Blocks whose file was removed by hand.
    const before = blocks.length;
    blocks = blocks.filter((b) => fs.existsSync(path.join(dir, b.file)));
    if (blocks.length !== before) writeIndex();
  }
  const blocksEnd = blocks.length ? blocks[blocks.length - 1].seq + blocks[blocks.length - 1].count : 0;

  const hotFiles = files
    .map((n) => HOT.exec(n))
    .filter(Boolean)
    .map((m) => ({ name: m[0], base: Number(m[1]) }))
    .sort((a, b) => a.base - b.base);
  let hotBase = blocksEnd;
  let hotLines = [];
  const live = hotFiles.filter((h) => h.base >= blocksEnd);
  if (live.length) {
    hotBase = Math.max(blocksEnd, live[0].base);
    for (const h of live) {
      // A compaction rewrites the remainder of a hot file into the next one: skip the overlap.
      const lines = completeLines(fs.readFileSync(path.join(dir, h.name), 'utf8'));
      const overlap = hotBase + hotLines.length - h.base;
      // A loop, not push(...): a big first batch can leave 100 000+ lines here.
      for (let i = Math.max(0, overlap); i < lines.length; i++) hotLines.push(lines[i]);
    }
  }
  let hotFile = path.join(dir, `hot-${hotBase}.ndjson`);
  if (!readOnly) {
    // Compacted already (crash before cleanup), or several files to merge back into one.
    for (const h of hotFiles) if (h.base < blocksEnd) fs.unlinkSync(path.join(dir, h.name));
    if (live.length !== 1 || live[0].name !== path.basename(hotFile) || fs.readFileSync(hotFile, 'utf8') !== (hotLines.length ? hotLines.join('\n') + '\n' : '')) {
      const tmp = hotFile + '.tmp';
      fs.writeFileSync(tmp, hotLines.length ? hotLines.join('\n') + '\n' : '');
      for (const h of live) fs.unlinkSync(path.join(dir, h.name));
      fs.renameSync(tmp, hotFile);
    }
  }

  // Seeded with the newest block and the hot events: a batch resent after a restart is dropped.
  const window = new IdWindow(windowSize);
  const newest = blocks[blocks.length - 1];
  if (newest && !readOnly) {
    try {
      const buf = Buffer.alloc(newest.length);
      const fd = fs.openSync(path.join(dir, newest.file), 'r');
      fs.readSync(fd, buf, 0, newest.length, newest.offset);
      fs.closeSync(fd);
      for (const line of zlib.brotliDecompressSync(buf).toString('utf8').split('\n')) {
        const id = line && idOf(line);
        if (id) window.add(id);
      }
    } catch {
      // Unreadable block: reads skip it too.
    }
  }
  for (const line of hotLines) {
    const id = idOf(line);
    if (id) window.add(id);
  }

  // --- Reads ---------------------------------------------------------------------------------
  const cache = new Map(); // seq → lines of that block, newest reads last
  async function blockLines(b) {
    const hit = cache.get(b.seq);
    if (hit) {
      cache.delete(b.seq);
      cache.set(b.seq, hit);
      return hit;
    }
    const fd = await fs.promises.open(path.join(dir, b.file), 'r');
    let lines;
    try {
      const buf = Buffer.alloc(b.length);
      await fd.read(buf, 0, b.length, b.offset);
      lines = (await unbrotli(buf)).toString('utf8').split('\n').filter(Boolean);
    } finally {
      await fd.close();
    }
    cache.set(b.seq, lines);
    if (cache.size > 2) cache.delete(cache.keys().next().value);
    return lines;
  }

  function findBlock(seq) {
    let lo = 0;
    let hi = blocks.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const b = blocks[mid];
      if (seq < b.seq) hi = mid - 1;
      else if (seq >= b.seq + b.count) lo = mid + 1;
      else return b;
    }
    return undefined;
  }

  // --- Writes --------------------------------------------------------------------------------
  let compacting = null; // { base, lines, promise }

  function writeIndex() {
    const tmp = indexFile + '.tmp';
    fs.writeFileSync(tmp, blocks.map((b) => JSON.stringify(b) + '\n').join(''));
    fs.renameSync(tmp, indexFile);
  }

  /** Turns the oldest `blockSize` hot events into a block; the rest moves to a new hot file. */
  async function compact() {
    const frozen = { base: hotBase, lines: hotLines.slice(0, blockSize), file: hotFile };
    const rest = hotLines.slice(blockSize);
    hotBase += frozen.lines.length;
    hotLines = rest;
    hotFile = path.join(dir, `hot-${hotBase}.ndjson`);
    fs.writeFileSync(hotFile, rest.length ? rest.join('\n') + '\n' : '');
    compacting = frozen;
    try {
      const body = await brotli(Buffer.from(frozen.lines.join('\n') + '\n'), BROTLI);
      const file = `${today()}.br`;
      const full = path.join(dir, file);
      const offset = fs.existsSync(full) ? fs.statSync(full).size : 0;
      fs.appendFileSync(full, body);
      const block = { file, offset, length: body.length, count: frozen.lines.length, seq: frozen.base };
      fs.appendFileSync(indexFile, JSON.stringify(block) + '\n');
      blocks.push(block);
      cache.set(block.seq, frozen.lines);
      if (cache.size > 2) cache.delete(cache.keys().next().value);
      fs.unlinkSync(frozen.file);
      applyRetention();
    } catch (e) {
      // The events are still in their hot file on disk: they are compacted on the next start.
      log(`compaction failed: ${e.message}`);
    } finally {
      compacting = null;
    }
  }

  function applyRetention() {
    if (!retentionDays) return;
    const cutoff = new Date(Date.now() - retentionDays * 86400_000).toISOString().slice(0, 10);
    const old = new Set(blocks.filter((b) => b.file.slice(0, 10) < cutoff).map((b) => b.file));
    if (!old.size) return;
    blocks = blocks.filter((b) => !old.has(b.file));
    writeIndex();
    for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
    cache.clear();
    log(`retention: removed ${[...old].join(', ')}`);
  }

  let pendingCompaction = Promise.resolve();
  function maybeCompact() {
    if (compacting || hotLines.length < blockSize) return;
    pendingCompaction = compact().then(maybeCompact);
  }

  if (!readOnly && hotLines.length >= blockSize) maybeCompact();

  return {
    dir,
    /** Events received since the folder was created, including those removed by retention. */
    get total() {
      return hotBase + hotLines.length;
    },
    /** Events stored now. */
    get size() {
      return hotBase + hotLines.length - (blocks[0]?.seq ?? compacting?.base ?? hotBase);
    },
    /** Bytes on disk (blocks + hot file). */
    get bytes() {
      let n = 0;
      for (const f of fs.readdirSync(dir)) if (SEGMENT.test(f) || HOT.test(f)) n += fs.statSync(path.join(dir, f)).size;
      return n;
    },

    /** Adds valid, new events. Returns how many were added. Synchronous and cheap. */
    append(batch, { receivedAt } = {}) {
      if (readOnly) throw new Error('read-only store');
      const now = new Date().toISOString();
      const ids = new Set();
      const lines = [];
      for (const e of batch) {
        if (!e || typeof e.id !== 'string' || typeof e.name !== 'string' || ids.has(e.id) || window.has(e.id)) continue;
        ids.add(e.id);
        const { id, ...rest } = e;
        lines.push(JSON.stringify({ id, ...rest, received_at: receivedAt === 'keep' && e.received_at ? e.received_at : now }));
      }
      if (!lines.length) return 0;
      // On disk first: if the write fails (disk full), nothing is counted and the app retries.
      fs.appendFileSync(hotFile, lines.join('\n') + '\n');
      for (const id of ids) window.add(id);
      for (const line of lines) hotLines.push(line);
      maybeCompact();
      return lines.length;
    },

    /**
     * One page of a read cursor, as a ready-to-send JSON body. A page never spans two blocks;
     * `next` is null once the reader is at the newest event.
     */
    async page(since, limit) {
      const first = blocks[0]?.seq ?? compacting?.base ?? hotBase;
      let from = Math.max(first, Math.floor(Number(since) || 0));
      const end = hotBase + hotLines.length;
      let lines = [];
      if (from < end) {
        let source;
        let start;
        if (from >= hotBase) {
          source = hotLines;
          start = hotBase;
        } else if (compacting && from >= compacting.base) {
          source = compacting.lines;
          start = compacting.base;
        } else {
          const b = findBlock(from);
          if (!b) {
            // A gap (block file removed by hand): jump to what comes next.
            const next = blocks.find((x) => x.seq > from);
            from = next ? next.seq : (compacting?.base ?? hotBase);
            return this.page(from, limit);
          }
          try {
            source = await blockLines(b);
          } catch (e) {
            log(`block ${b.file}@${b.offset} unreadable, skipped: ${e.message}`);
            return this.page(b.seq + b.count, limit);
          }
          start = b.seq;
        }
        lines = source.slice(from - start, from - start + limit);
      }
      const cursor = from + lines.length;
      const next = cursor < hotBase + hotLines.length ? String(cursor) : null;
      return { body: `{"events":[${lines.join(',')}],"next_cursor":${next === null ? 'null' : `"${next}"`},"cursor":"${cursor}"}`, count: lines.length, cursor };
    },

    /** Every stored line, oldest first. */
    async *lines() {
      for (const b of [...blocks]) yield* await blockLines(b);
      if (compacting) yield* compacting.lines;
      yield* hotLines;
    },

    /** Resolves once no compaction is running (tests, shutdown). */
    async idle() {
      while (compacting) await pendingCompaction;
    },

    /** Compacts the hot events now, even if fewer than a block (tests, `compact` command). */
    async compactNow() {
      await this.idle();
      if (hotLines.length) await compact();
    },

    close() {
      release();
    },
  };
}
