const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadWorker(upstreamFetch) {
  const source = fs.readFileSync(path.resolve(__dirname, '../_worker.js'), 'utf8')
    .replace('export default {', 'globalThis.__worker = {');
  const context = {
    URL,
    Headers,
    Request,
    Response,
    fetch: upstreamFetch,
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: '_worker.js' });
  return context.__worker;
}

test('proxy uses fixed API origin and never emits X-Target', async () => {
  let upstream;
  const worker = loadWorker(async (url, init) => {
    upstream = { url, init };
    return new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } });
  });
  const request = new Request('https://astro-natal.pages.dev/api/profile', {
    headers: { Origin: 'https://astro.burlab-api.site', Authorization: 'tma signed' },
  });
  const response = await worker.fetch(request, {});

  assert.equal(upstream.url, 'https://astro.burlab-api.site/api/profile');
  assert.equal(upstream.init.headers.get('Authorization'), 'tma signed');
  assert.equal(response.headers.get('X-Target'), null);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://astro.burlab-api.site');
  assert.equal(response.headers.get('Vary'), 'Origin');
});

test('caller-controlled X-Target cannot change upstream', async () => {
  let target;
  const worker = loadWorker(async (url) => {
    target = url;
    return new Response('{}');
  });
  await worker.fetch(new Request('https://astro-natal.pages.dev/api/history', {
    headers: { 'X-Target': 'https://attacker.invalid' },
  }), {});
  assert.equal(target, 'https://astro.burlab-api.site/api/history');
});

test('CORS allowlist rejects unknown origins and preflight allows auth header', async () => {
  const worker = loadWorker(async () => new Response('{}'));
  const denied = await worker.fetch(new Request('https://astro-natal.pages.dev/api/profile', {
    headers: { Origin: 'https://attacker.invalid' },
  }), {});
  assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);

  const allowed = await worker.fetch(new Request('https://astro-natal.pages.dev/api/profile', {
    method: 'OPTIONS',
    headers: { Origin: 'https://astro.burlab-api.site' },
  }), {});
  assert.equal(allowed.status, 204);
  assert.match(allowed.headers.get('Access-Control-Allow-Headers'), /Authorization/i);
});
