export const AUTH_STORAGE_KEY = 'rebarAuth';

export function parseStoredSession(raw) {
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw);
    return typeof payload?.token === 'string' && payload.token ? payload : null;
  } catch {
    return null;
  }
}

export function clearStoredSession(storage = localStorage) {
  storage.removeItem(AUTH_STORAGE_KEY);
}

export function isUnauthorizedResponse(error) {
  return error?.response?.status === 401;
}
