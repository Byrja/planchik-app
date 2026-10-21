const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadApi(nativeFetch, initData = '') {
  const file = path.resolve(__dirname, '../js/api-auth.js');
  const context = {
    URL,
    Headers,
    Request,
    location: { origin: 'https://astro.burlab-api.site' },
    Telegram: { WebApp: { initData } },
    fetch: nativeFetch,
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
