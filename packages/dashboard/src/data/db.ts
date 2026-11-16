import * as duckdb from '@duckdb/duckdb-wasm';
import { Type } from 'apache-arrow';
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

let dbPromise: Promise<{ db: duckdb.AsyncDuckDB; conn: duckdb.AsyncDuckDBConnection }> | null = null;

/** DuckDB runs in a Web Worker; bundles are served from this site, never a CDN. */
export function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const bundle = await duckdb.selectBundle({
        mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
        eh: { mainModule: ehWasm, mainWorker: ehWorker },
      });
      const worker = new Worker(bundle.mainWorker!);
      const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      const conn = await db.connect();
      await conn.query(`
        CREATE TABLE IF NOT EXISTS events (
          id VARCHAR PRIMARY KEY,
          name VARCHAR,
          ts TIMESTAMP,
          anon_id VARCHAR,
          user_id VARCHAR,
          uid VARCHAR,
          props JSON,
          context JSON,
          app_version VARCHAR,
          platform VARCHAR,
          variant VARCHAR,
          feature VARCHAR
        )`);
      return { db, conn };
    })();
  }
  return dbPromise;
}

export type Row = Record<string, unknown>;

/** Runs a query and returns plain JS rows (BigInt → number, timestamps → Date). */
export async function query<T = Row>(sql: string): Promise<T[]> {
  const { conn } = await getDb();
  const table = await conn.query(sql);
  const fields = table.schema.fields;
  const out: T[] = [];
  for (const r of table.toArray()) {
    const o: Row = {};
    for (const f of fields) {
      let v: unknown = r[f.name];
      if (typeof v === 'bigint') v = Number(v);
      // HUGEINT / DECIMAL arrive as Arrow objects: go through their string form.
      else if ((f.typeId === Type.Decimal || f.typeId === Type.Int) && v !== null && typeof v === 'object') v = Number(String(v));
      if (f.typeId === Type.Timestamp && typeof v === 'number') v = new Date(v);
      o[f.name] = v;
    }
    out.push(o as T);
  }
  return out;
}

/** SQL string literal. */
export function lit(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

const INSERT_FROM = (src: string) => `
  INSERT OR IGNORE INTO events
  SELECT
    CAST(id AS VARCHAR),
    CAST(name AS VARCHAR),
    CAST(ts AS TIMESTAMP),
    CAST(anon_id AS VARCHAR),
    NULLIF(CAST(user_id AS VARCHAR), ''),
    COALESCE(NULLIF(CAST(user_id AS VARCHAR), ''), CAST(anon_id AS VARCHAR)),
    COALESCE(CAST(props AS JSON), '{}'::JSON),
    COALESCE(CAST(context AS JSON), '{}'::JSON),
    CAST(context AS JSON)->>'app_version',
    CAST(context AS JSON)->>'platform',
    CAST(context AS JSON)->>'variant',
    CAST(context AS JSON)->>'feature'
  FROM ${src}
  WHERE id IS NOT NULL AND name IS NOT NULL AND ts IS NOT NULL`;

/** Inserts rows from any DuckDB table function with the event columns. */
export async function insertFrom(src: string): Promise<void> {
  const { conn } = await getDb();
  await conn.query(INSERT_FROM(src));
}

let fileSeq = 0;

/** Adds events given as JS objects (from an API or Supabase). Duplicates (same id) are ignored. */
export async function insertEvents(events: unknown[]): Promise<number> {
  if (!events.length) return 0;
  const { db, conn } = await getDb();
  const name = `batch_${++fileSeq}.ndjson`;
  const ndjson = events.map((e) => JSON.stringify(e)).join('\n');
  await db.registerFileText(name, ndjson);
  const before = await countEvents();
  await conn.query(
    INSERT_FROM(`read_json(${lit(name)}, format='newline_delimited', columns={id:'VARCHAR', name:'VARCHAR', ts:'VARCHAR', anon_id:'VARCHAR', user_id:'VARCHAR', props:'JSON', context:'JSON'})`)
  );
  await db.dropFile(name);
  return (await countEvents()) - before;
}

/** Imports a CSV, JSON / NDJSON or Parquet export of an events table. */
export async function importFile(file: File): Promise<number> {
  const { db, conn } = await getDb();
  const ext = file.name.toLowerCase().split('.').pop();
  const name = `import_${++fileSeq}.${ext}`;
  await db.registerFileHandle(name, file, duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, true);
  let src: string;
  if (ext === 'parquet') src = `read_parquet(${lit(name)})`;
  else if (ext === 'csv') src = `read_csv(${lit(name)}, all_varchar=true, header=true)`;
  else if (ext === 'json' || ext === 'ndjson' || ext === 'jsonl') {
    src = `read_json(${lit(name)}, columns={id:'VARCHAR', name:'VARCHAR', ts:'VARCHAR', anon_id:'VARCHAR', user_id:'VARCHAR', props:'JSON', context:'JSON'})`;
  } else throw new Error('Unsupported file: use .csv, .json, .ndjson or .parquet');
  const before = await countEvents();
  await conn.query(INSERT_FROM(src));
  await db.dropFile(name);
  return (await countEvents()) - before;
}

export async function countEvents(): Promise<number> {
  const [r] = await query<{ n: number }>('SELECT count(*) AS n FROM events');
  return r.n;
}

export async function clearEvents(): Promise<void> {
  const { conn } = await getDb();
  await conn.query('DELETE FROM events');
}
