import { isBoard, loadBoards, saveBoards, type Board } from './boards';
import { brandingStore, cleanBranding, type Branding } from './branding';
import { catalogStore, EMPTY_CATALOG, mergeCatalog, parseCatalog, type Catalog } from './catalog';
import { isArray, isObject } from './storage';

/**
 * Everything a team customizes, in one shareable file: boards, the event catalog and the
 * branding. Never holds data sources or credentials.
 */
export interface Workspace {
  shipstat: 'workspace';
  version: 1;
  exported_at?: string;
  branding: Branding;
  catalog: Catalog;
  boards: Board[];
}

export function parseWorkspace(v: unknown): Workspace | null {
  if (!isObject(v)) return null;
  const boards = isArray(v.boards) ? v.boards.filter(isBoard) : [];
  const catalog = v.catalog === undefined ? null : parseCatalog(v.catalog);
  const branding = cleanBranding(v.branding);
  // A bare tracking plan is a workspace with only a catalog.
  const plan = v.shipstat === 'workspace' ? null : parseCatalog(v);
  if (!boards.length && !catalog && !Object.keys(branding).length && !plan) return null;
  return { shipstat: 'workspace', version: 1, branding, catalog: catalog ?? plan ?? EMPTY_CATALOG, boards };
}

/** `incoming` wins: same-id boards are replaced in place, new ones appended, others kept. */
export function mergeWorkspace(local: Omit<Workspace, 'shipstat' | 'version'>, incoming: Workspace) {
  const byId = new Map(incoming.boards.map((b) => [b.id, b]));
  const boards = [...local.boards.map((b) => byId.get(b.id) ?? b), ...incoming.boards.filter((b) => !local.boards.some((x) => x.id === b.id))];
  return {
    boards,
    catalog: mergeCatalog(local.catalog, incoming.catalog),
    branding: { ...local.branding, ...incoming.branding },
  };
}

export function exportWorkspace(): Workspace {
  return { shipstat: 'workspace', version: 1, exported_at: new Date().toISOString(), branding: cleanBranding(brandingStore.get()), catalog: catalogStore.get(), boards: loadBoards() };
}

export function applyWorkspace(ws: Workspace) {
  const next = mergeWorkspace({ boards: loadBoards(), catalog: catalogStore.get(), branding: brandingStore.get() }, ws);
  saveBoards(next.boards);
  catalogStore.set(next.catalog);
  brandingStore.set(cleanBranding(next.branding));
}

/** FNV-1a, enough to notice that a shared file changed. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

const APPLIED = 'shipstat.workspace.applied';

/**
 * A workspace shared by the server is the team baseline. It is applied when it changes, so
 * editing the file shows on reload, while local edits made since stay until the next change.
 */
export function applyShared(ws: Workspace): boolean {
  const h = hash(JSON.stringify({ ...ws, exported_at: undefined }));
  try {
    if (localStorage.getItem(APPLIED) === h) return false;
    localStorage.setItem(APPLIED, h);
  } catch {
    // No storage: apply on every visit.
  }
  applyWorkspace(ws);
  return true;
}

/** Inline `workspace` wins over `workspaceUrl`. */
export async function loadSharedWorkspace(cfg: { workspace?: unknown; workspaceUrl?: string }): Promise<Workspace | null> {
  if (cfg.workspace) return parseWorkspace(cfg.workspace);
  if (!cfg.workspaceUrl) return null;
  try {
    const res = await fetch(new URL(cfg.workspaceUrl, location.href), { cache: 'no-store' });
    return res.ok ? parseWorkspace(await res.json()) : null;
  } catch {
    return null;
  }
}
