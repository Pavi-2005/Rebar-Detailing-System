import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import app from './src/server.js';
import User from './src/models/User.js';
import SlabDesign from './src/models/SlabDesign.js';
import { getHistory, deleteHistory } from './src/controllers/historyController.js';
import { ownedDesignFilter } from './src/utils/ownedDesignFilter.js';

process.env.JWT_SECRET = 'test-only-jwt-secret-with-at-least-32-characters';

let server;
let baseUrl;

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test('public health and auth routes remain accessible without a session', async () => {
  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(login.status, 400);
});

test('private design, report, history, and current-user APIs reject missing tokens', async () => {
  const requests = [
    ['POST', '/api/beams/design'],
    ['POST', '/api/slabs/design'],
    ['POST', '/api/columns/design'],
    ['POST', '/api/footings/design'],
    ['POST', '/api/reports/pdf'],
    ['GET', '/api/history'],
    ['DELETE', '/api/history/507f1f77bcf86cd799439011'],
    ['GET', '/api/auth/me']
  ];

  for (const [method, path] of requests) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify({})
    });
    assert.equal(response.status, 401, `${method} ${path} must require authentication`);
  }
});

test('current-user endpoint accepts a valid token and rejects an expired token', async () => {
  const originalFindById = User.findById;
  User.findById = async (id) => ({ _id: id, name: 'Test Engineer', email: 'engineer@example.com' });
  const token = jwt.sign(
    { id: '507f1f77bcf86cd799439011', email: 'engineer@example.com', name: 'Test Engineer' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  try {
    const validResponse = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(validResponse.status, 200);
    assert.deepEqual(await validResponse.json(), {
      user: { name: 'Test Engineer', email: 'engineer@example.com' }
    });

    const expiredToken = jwt.sign(
      { id: '507f1f77bcf86cd799439011' },
      process.env.JWT_SECRET,
      { expiresIn: -1 }
    );
    const expiredResponse = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${expiredToken}` }
    });
    assert.equal(expiredResponse.status, 401);

    User.findById = async () => null;
    const deletedAccountResponse = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(deletedAccountResponse.status, 401);
  } finally {
    User.findById = originalFindById;
  }
});

test('record ownership queries are scoped to the authenticated account', () => {
  assert.deepEqual(ownedDesignFilter({ id: 'user-a', email: 'a@example.com' }), {
    $or: [
      { ownerId: 'user-a' },
      {
        $and: [
          { ownerId: { $in: [null] } },
          { 'user.email': 'a@example.com' }
        ]
      }
    ]
  });
  assert.deepEqual(ownedDesignFilter({}), { _id: null });
});

test('history reads and deletes only records owned by the authenticated user', async () => {
  const originalFind = SlabDesign.find;
  const originalDeleteOne = SlabDesign.deleteOne;
  let readFilter;
  let deleteFilter;
  const records = [{ projectName: 'Owned design' }];
  SlabDesign.find = (filter) => {
    readFilter = filter;
    return { sort: async () => records };
  };
  SlabDesign.deleteOne = async (filter) => {
    deleteFilter = filter;
    return { deletedCount: 1 };
  };
  const user = { id: '507f1f77bcf86cd799439011', email: 'engineer@example.com' };
  const response = {
    statusCode: 200,
    body: undefined,
    json(body) {
      this.body = body;
      return this;
    }
  };

  try {
    await getHistory({ user }, response);
    assert.deepEqual(response.body, records);
    assert.deepEqual(readFilter, ownedDesignFilter(user));

    await deleteHistory({ user, params: { id: 'design-id' } }, response);
    assert.equal(response.body.success, true);
    assert.deepEqual(deleteFilter, { _id: 'design-id', ...ownedDesignFilter(user) });
  } finally {
    SlabDesign.find = originalFind;
    SlabDesign.deleteOne = originalDeleteOne;
  }
});
