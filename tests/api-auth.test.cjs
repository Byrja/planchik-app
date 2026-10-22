const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadApi(nativeFetch, initData = '', extras = {}) {
  const file = path.resolve(__dirname, '../js/api-auth.js');
  const context = {
    URL,
    Headers,
    Request,
    location: { origin: 'https://astro.burlab-api.site' },
    Telegram: { WebApp: { initData } },
    fetch: nativeFetch,
    ...extras,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: 'api-auth.js' });
  return context.GadalkaApi;
}

test('moves Telegram initData to Authorization and removes it from URL', async () => {
  let captured;
  const api = loadApi(async (url, init) => {
    captured = { url, init };
    return new Response('{}', { status: 200 });
  }, 'query_id=secret&user=%7B%22id%22%3A1%7D');

  await api.fetch('/api/history?type=tarot&initData=query%3Dlegacy');
  assert.equal(captured.url, '/api/history?type=tarot');
  assert.equal(captured.init.headers.get('Authorization'), 'tma query=legacy');
  assert.equal(captured.url.includes('initData'), false);
});

test('uses Telegram WebApp initData when URL is already credential-free', async () => {
  let captured;
  const api = loadApi(async (url, init) => {
    captured = { url, init };
    return new Response('{}', { status: 200 });
  }, 'signed=telegram');

  await api.fetch('/api/profile', { headers: { 'Content-Type': 'application/json' } });
  assert.equal(captured.url, '/api/profile');
  assert.equal(captured.init.headers.get('Authorization'), 'tma signed=telegram');
  assert.equal(captured.init.headers.get('Content-Type'), 'application/json');
});

test('does not invent an auth header for a browser demo session', async () => {
  let captured;
  const api = loadApi(async (url, init) => {
    captured = { url, init };
    return new Response('{}', { status: 200 });
  });

  await api.fetch('/api/arc/daily?days=30');
  assert.equal(captured.url, '/api/arc/daily?days=30');
  assert.equal(captured.init.headers.has('Authorization'), false);
});

test('paid fetch retains one ID across ambiguous retries and clears it after success', async () => {
  const calls = [];
  const storage = new Map();
  let sequence = 0;
  let behavior = 'throw';
  const api = loadApi(async (url, init) => {
    calls.push({ url, id: init.headers.get('x-request-id') });
    if (behavior === 'throw') throw new TypeError('network lost after send');
    const body = behavior === '409' ? { error: 'request_in_progress' } : {};
    return new Response(JSON.stringify(body), { status: behavior === 'ok' ? 200 : Number(behavior) });
  }, 'signed=telegram', {
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}` },
    sessionStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
  });
  const options = { method: 'POST', body: JSON.stringify({ spread: 'single' }) };

  await assert.rejects(() => api.paidFetch('/api/arc/interpret', options), /network lost/);
  const ambiguousId = calls.at(-1).id;
  behavior = '500';
  await api.paidFetch('/api/arc/interpret', options);
  assert.equal(calls.at(-1).id, ambiguousId);
  behavior = '409';
  await api.paidFetch('/api/arc/interpret', options);
  assert.equal(calls.at(-1).id, ambiguousId, 'in-progress retry lost its logical action ID');
  behavior = '429';
  await api.paidFetch('/api/arc/interpret', options);
  assert.equal(calls.at(-1).id, ambiguousId, 'rate-limited retry lost its logical action ID');
  behavior = 'ok';
  await api.paidFetch('/api/arc/interpret', options);
  assert.equal(calls.at(-1).id, ambiguousId);
  await api.paidFetch('/api/arc/interpret', options);
  assert.notEqual(calls.at(-1).id, ambiguousId, 'delivered success must start a new logical action');
  assert.equal([...storage.keys()].some((key) => key.includes('single')), false, 'payload leaked into storage key');
});

test('paid fetch retires a terminal idempotency conflict but retains request_in_progress', async () => {
  const calls = [];
  const storage = new Map();
  let sequence = 0;
  let error = 'idempotency_conflict';
  const api = loadApi(async (_url, init) => {
    calls.push(init.headers.get('x-request-id'));
    return new Response(JSON.stringify({ error }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    });
  }, 'signed=telegram', {
    crypto: { randomUUID: () => `conflict-${++sequence}` },
    sessionStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
  });
  const options = { method: 'POST' };

  await api.paidFetch('/api/chart/interpret', options);
  const conflictingId = calls.at(-1);
  error = 'request_in_progress';
  await api.paidFetch('/api/chart/interpret', options);
  const replacementId = calls.at(-1);
  assert.notEqual(replacementId, conflictingId, 'terminal conflict must retire the stale logical action ID');
  await api.paidFetch('/api/chart/interpret', options);
  assert.equal(calls.at(-1), replacementId, 'request_in_progress must preserve the replacement ID');
});

test('paid fetch scopes pending IDs by payload while generic POSTs stay one-shot', async () => {
  const calls = [];
  let sequence = 0;
  const api = loadApi(async (_url, init) => {
    calls.push(init.headers.get('x-request-id'));
    throw new TypeError('offline');
  }, '', { crypto: { randomUUID: () => `request-${String(++sequence).padStart(8, '0')}` } });

  await assert.rejects(() => api.paidFetch('/api/dreambook/interpret', { method: 'POST', body: '{"mode":"short"}' }));
  const shortId = calls.at(-1);
  await assert.rejects(() => api.paidFetch('/api/dreambook/interpret', { method: 'POST', body: '{"mode":"deep"}' }));
  assert.notEqual(calls.at(-1), shortId, 'changed payload reused a pending paid ID');
  await assert.rejects(() => api.fetch('/api/history', { method: 'POST' }));
  const genericId = calls.at(-1);
  await assert.rejects(() => api.fetch('/api/history', { method: 'POST' }));
  assert.notEqual(calls.at(-1), genericId, 'generic POST accidentally inherited paid retry semantics');
});
