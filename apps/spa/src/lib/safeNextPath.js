const SAFE_ORIGIN = 'https://misu.invalid';
const DEFAULT_PATH = '/app/booking';

/**
 * Sanitizes a raw `next` query value against a fixed same-origin base so
 * off-origin redirects (protocol-relative, backslash tricks, control-char
 * normalization, dot-segment bypasses) can never be produced.
 */
function sanitizeNext(raw) {
  if (typeof raw !== 'string' || raw === '') return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;

  let url;
  try {
    url = new URL(raw, SAFE_ORIGIN);
  } catch {
    return null;
  }

  if (url.origin !== SAFE_ORIGIN) return null;
  if (url.pathname.startsWith('//')) return null;
  // A `next` that resolves back to the login route itself would strand the
  // user in a login -> login redirect loop, so it is treated as unsafe.
  if (url.pathname === '/login' || url.pathname === '/app/login') return null;

  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Resolves the redirect target for a login query string. Returns the
 * sanitized path (default `/app/booking` when missing or unsafe) along with
 * whether an explicit, valid `next` value was supplied.
 */
export function resolveNextPath(search) {
  const raw = new URLSearchParams(search).get('next');
  const sanitized = raw ? sanitizeNext(raw) : null;
  return sanitized
    ? { path: sanitized, hasExplicitNext: true }
    : { path: DEFAULT_PATH, hasExplicitNext: false };
}

/**
 * Builds the login redirect URL, preserving the Wouter pathname and the full
 * current search string as the `next` query value.
 */
export function loginRedirectUrl(pathname, search, isDev) {
  const loginPath = isDev ? '/app/login' : '/login';
  const next = `${pathname}${search || ''}`;
  return `${loginPath}?next=${encodeURIComponent(next)}`;
}
