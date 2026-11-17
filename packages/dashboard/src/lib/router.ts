export type Route =
  | { page: 'boards'; id?: string }
  | { page: 'overview' }
  | { page: 'event'; name?: string }
  | { page: 'paths'; name?: string }
  | { page: 'experiments' }
  | { page: 'catalog' }
  | { page: 'settings' }
  | { page: 'data' };

export function parseHash(hash: string): Route {
  const h = decodeURIComponent(hash.replace(/^#\/?/, ''));
  const [head, ...rest] = h.split('/');
  const arg = rest.join('/') || undefined;
  switch (head) {
    case 'boards':
      return { page: 'boards', id: arg };
    case 'overview':
      return { page: 'overview' };
    case 'event':
      return { page: 'event', name: arg };
    case 'paths':
      return { page: 'paths', name: arg };
    case 'experiments':
      return { page: 'experiments' };
    case 'catalog':
      return { page: 'catalog' };
    case 'settings':
      return { page: 'settings' };
    case 'data':
      return { page: 'data' };
    default:
      return { page: 'boards' };
  }
}

export function href(r: Route): string {
  if ((r.page === 'event' || r.page === 'paths') && r.name) return `#${r.page}/${encodeURIComponent(r.name)}`;
  if (r.page === 'boards' && r.id) return `#boards/${encodeURIComponent(r.id)}`;
  return `#${r.page}`;
}

export function go(r: Route) {
  location.hash = href(r);
}
