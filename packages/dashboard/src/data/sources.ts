import { insertEvents } from './db';

export type Source =
  | { kind: 'api'; url: string; headerName: string; headerValue: string; cursor?: string }
  | { kind: 'supabase'; url: string; key: string; table: string; cursor?: string }
  | { kind: 'file'; fileName?: string }
  | { kind: 'demo' };

export interface Project {
  id: string;
  name: string;
  source: Source;
  lastSync?: string;
}

const KEY = 'shipstat.projects.v1';

export function loadProjects(): Project[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function saveProjects(p: Project[]) {
  localStorage.setItem(KEY, JSON.stringify(p));
}

export interface SyncResult {
  added: number;
  cursor?: string;
}

/**
 * Reads every page from a Shipstat read endpoint: GET url?since=<cursor>&limit=5000
 * → { events, next_cursor, cursor? }. Starts from scratch: events live in memory for now.
 */
export async function syncApi(src: Extract<Source, { kind: 'api' }>, onProgress?: (n: number) => void): Promise<SyncResult> {
  let cursor = '';
  let added = 0;
  for (let page = 0; page < 10_000; page++) {
    const u = new URL(src.url);
    if (cursor) u.searchParams.set('since', cursor);
    u.searchParams.set('limit', '5000');
    const headers: Record<string, string> = {};
    if (src.headerName && src.headerValue) headers[src.headerName] = src.headerValue;
    const res = await fetch(u, { headers });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${u.host}`);
    const body = await res.json();
    if (!Array.isArray(body?.events)) throw new Error('The read endpoint must return { events: [...], next_cursor }');
    added += await insertEvents(body.events);
    onProgress?.(added);
    if (!body.next_cursor) return { added, cursor: body.cursor ?? cursor };
    cursor = String(body.next_cursor);
  }
  return { added, cursor };
}

/** Reads a Supabase table through its REST API, ordered by received_at then id. */
export async function syncSupabase(src: Extract<Source, { kind: 'supabase' }>, onProgress?: (n: number) => void): Promise<SyncResult> {
  const base = src.url.replace(/\/$/, '') + '/rest/v1/' + encodeURIComponent(src.table || 'events');
  const pageSize = 1000;
  let added = 0;
  for (let offset = 0; offset < 50_000_000; offset += pageSize) {
    const res = await fetch(`${base}?select=id,name,ts,anon_id,user_id,props,context&order=received_at.asc,id.asc&limit=${pageSize}&offset=${offset}`, {
      headers: { apikey: src.key, Authorization: `Bearer ${src.key}` },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} from Supabase`);
    const rows = await res.json();
    added += await insertEvents(rows);
    onProgress?.(added);
    if (rows.length < pageSize) break;
  }
  return { added };
}
