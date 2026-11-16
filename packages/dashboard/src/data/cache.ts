import { getDb, insertFrom, lit } from './db';

/**
 * Keeps loaded events between visits: a Parquet snapshot in the browser's private
 * file system (OPFS). Nothing is sent anywhere.
 */
const FILE = 'shipstat-events.parquet';
const META = 'shipstat.cache.v1';

export interface CacheMeta {
  source: string;
  savedAt: string;
}

async function dir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await navigator.storage.getDirectory();
  } catch {
    return null;
  }
}

export async function saveCache(source: string): Promise<void> {
  const root = await dir();
  if (!root) return;
  const { db, conn } = await getDb();
  await conn.query(`COPY (SELECT id, name, CAST(ts AS VARCHAR) ts, anon_id, user_id, CAST(props AS VARCHAR) props, CAST(context AS VARCHAR) context FROM events) TO ${lit(FILE)} (FORMAT parquet)`);
  const buf = await db.copyFileToBuffer(FILE);
  await db.dropFile(FILE);
  const handle = await root.getFileHandle(FILE, { create: true });
  const w = await handle.createWritable();
  await w.write(buf.slice());
  await w.close();
  localStorage.setItem(META, JSON.stringify({ source, savedAt: new Date().toISOString() } satisfies CacheMeta));
}

export async function restoreCache(): Promise<CacheMeta | null> {
  const root = await dir();
  const raw = localStorage.getItem(META);
  if (!root || !raw) return null;
  try {
    const file = await (await root.getFileHandle(FILE)).getFile();
    const { db } = await getDb();
    await db.registerFileBuffer('restore.parquet', new Uint8Array(await file.arrayBuffer()));
    await insertFrom(`read_parquet('restore.parquet')`);
    await db.dropFile('restore.parquet');
    return JSON.parse(raw) as CacheMeta;
  } catch {
    return null;
  }
}

export async function clearCache(): Promise<void> {
  localStorage.removeItem(META);
  const root = await dir();
  await root?.removeEntry(FILE).catch(() => undefined);
}
