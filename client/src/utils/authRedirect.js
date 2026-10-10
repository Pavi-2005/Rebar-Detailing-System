const AUTH_ROUTES = new Set(['/login', '/signup']);

export function getReturnTo(from, fallback = '/dashboard') {
  const pathname = from?.pathname;
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.startsWith('//') || AUTH_ROUTES.has(pathname)) {
    return fallback;
  }

  return `${pathname}${from.search || ''}${from.hash || ''}`;
}
