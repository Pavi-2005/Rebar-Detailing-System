import test from 'node:test';
import assert from 'node:assert/strict';
import { getReturnTo } from './src/utils/authRedirect.js';
import api, { setAuthToken } from './src/services/api.js';
import { AUTH_STORAGE_KEY, clearStoredSession, isUnauthorizedResponse, parseStoredSession } from './src/utils/authSession.js';

test('authenticated redirect preserves the requested path, query, and fragment', () => {
  assert.equal(
    getReturnTo({ pathname: '/beam', search: '?project=bridge', hash: '#results' }),
    '/beam?project=bridge#results'
  );
});

test('auth redirect falls back instead of returning to a public auth route or external path', () => {
  assert.equal(getReturnTo(null), '/dashboard');
  assert.equal(getReturnTo({ pathname: '/login' }), '/dashboard');
  assert.equal(getReturnTo({ pathname: '/signup' }), '/dashboard');
  assert.equal(getReturnTo({ pathname: '//attacker.example' }), '/dashboard');
});

test('stored session parsing rejects malformed or tokenless storage', () => {
  assert.equal(parseStoredSession('{'), null);
  assert.equal(parseStoredSession(JSON.stringify({ user: { name: 'Cached only' } })), null);
  assert.deepEqual(parseStoredSession(JSON.stringify({ token: 'session-token', user: { name: 'Verified later' } })), {
    token: 'session-token',
    user: { name: 'Verified later' }
  });
});

test('logout clears the stored session and bearer token; only 401 expires a session', () => {
  const values = new Map([[AUTH_STORAGE_KEY, JSON.stringify({ token: 'session-token' })]]);
  const storage = { removeItem: (key) => values.delete(key) };
  setAuthToken('session-token');
  assert.equal(api.defaults.headers.common.Authorization, 'Bearer session-token');

  clearStoredSession(storage);
  setAuthToken(null);
  assert.equal(values.has(AUTH_STORAGE_KEY), false);
  assert.equal(api.defaults.headers.common.Authorization, undefined);
  assert.equal(isUnauthorizedResponse({ response: { status: 401 } }), true);
  assert.equal(isUnauthorizedResponse({ response: { status: 403 } }), false);
});
