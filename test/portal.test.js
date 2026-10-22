import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createApp } from '../lib/app.js';
import { Mikrotik } from '../lib/mikrotik.js';

const origin = 'https://wifi.example.test';
const valid = { username: 'alex', currentPassword: 'old-password', newPassword: 'fresh-password!', confirmPassword: 'fresh-password!' };

async function fixture(t, overrides = {}, appOptions = {}) {
  const state = { password: valid.currentPassword, patches: [], queries: [], ...overrides };
  const router = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, `Basic ${Buffer.from('portal:router-secret').toString('base64')}`);
    const url = new URL(request.url, 'http://router');
    response.setHeader('Content-Type', 'application/json');
    if (state.failure) {
      response.writeHead(403);
      return response.end(JSON.stringify({ message: 'router-secret internal diagnostic' }));
    }
    if (request.method === 'GET') {
      state.queries.push(url.searchParams.get('name'));
      const users = state.missing ? [] : [{ '.id': '*A', name: valid.username, password: state.password, disabled: state.disabled ?? 'false' }];
      return response.end(JSON.stringify(users));
    }
    assert.equal(request.method, 'PATCH');
    assert.equal(decodeURIComponent(url.pathname), '/rest/ip/hotspot/user/*A');
    let body = '';
    for await (const chunk of request) body += chunk;
    const update = JSON.parse(body);
    state.patches.push(update);
    state.password = update.password;
    response.end(JSON.stringify({ '.id': '*A', password: state.password }));
  });
  router.listen(0, '127.0.0.1');
  await once(router, 'listening');
  const mikrotik = new Mikrotik({ url: `http://127.0.0.1:${router.address().port}`, username: 'portal', password: 'router-secret' });
  const app = createApp({ mikrotik, origin, ...appOptions });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(async () => {
    await Promise.all([new Promise(resolve => app.close(resolve)), new Promise(resolve => router.close(resolve))]);
  });
  const url = `http://127.0.0.1:${app.address().port}`;
  const post = (input = valid, headers = {}) => fetch(`${url}/api/change-password`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input),
  });
  return { state, post, url };
}

test('changes exactly the authenticated hotspot account through the router API', async t => {
  const { post, state } = await fixture(t);
  const response = await post();
  assert.equal(response.status, 200);
  assert.deepEqual(state.patches, [{ password: valid.newPassword }]);
  assert.deepEqual(state.queries, ['alex']);
  const body = await response.text();
  assert.match(body, /updated/);
  assert.ok(!body.includes(valid.newPassword));
  assert.ok(!body.includes('router-secret'));
  const replay = await post();
  assert.equal(replay.status, 401);
  assert.equal(state.patches.length, 1);
  const next = 'another-password!';
  assert.equal((await post({ ...valid, currentPassword: valid.newPassword, newPassword: next, confirmPassword: next })).status, 200);
});

for (const [label, overrides, input] of [
  ['wrong current password', {}, { ...valid, currentPassword: 'wrong' }],
  ['unknown username', { missing: true }, valid],
  ['disabled account', { disabled: 'true' }, valid],
  ['hidden password', { password: undefined }, valid],
]) {
  test(`rejects ${label} without changing the router`, async t => {
    const { post, state } = await fixture(t, overrides);
    const response = await post(input);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).message, 'Your username or current password is incorrect.');
    assert.equal(state.patches.length, 0);
  });
}

for (const [label, input] of [
  ['mismatched confirmation', { ...valid, confirmPassword: 'different' }],
  ['short new password', { ...valid, newPassword: 'short', confirmPassword: 'short' }],
  ['unchanged password', { ...valid, newPassword: valid.currentPassword, confirmPassword: valid.currentPassword }],
  ['missing fields', {}],
  ['non-string fields', { ...valid, username: 42 }],
  ['null payload', null],
]) {
  test(`validates ${label} before contacting MikroTik`, async t => {
    const { post, state } = await fixture(t);
    assert.equal((await post(input)).status, 400);
    assert.equal(state.queries.length, 0);
    assert.equal(state.patches.length, 0);
  });
}

test('rejects cross-origin submissions and non-JSON requests', async t => {
  const { post, state } = await fixture(t);
  assert.equal((await post(valid, { Origin: 'https://attacker.test' })).status, 403);
  assert.equal((await post(valid, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal(state.queries.length, 0);
});

test('limits repeated attempts and returns a retry interval', async t => {
  const { post } = await fixture(t);
  for (let index = 0; index < 10; index++) assert.equal((await post({ ...valid, currentPassword: 'wrong' })).status, 401);
  const response = await post();
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '900');
});

test('uses the client address supplied by a trusted reverse proxy', async t => {
  const { post } = await fixture(t, {}, { trustProxy: true });
  for (let index = 0; index < 10; index++) {
    assert.equal((await post({ ...valid, username: `user-${index}`, currentPassword: 'wrong' }, { 'X-Forwarded-For': '192.0.2.10' })).status, 401);
  }
  assert.equal((await post(valid, { 'X-Forwarded-For': '192.0.2.11' })).status, 200);
});

test('hides router errors and never patches on a lookup failure', async t => {
  const { post, state } = await fixture(t, { failure: true });
  const response = await post();
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes('router-secret'));
  assert.equal(state.patches.length, 0);
});

test('serves the English portal with security headers and no private files', async t => {
  const { url } = await fixture(t);
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<html lang="en">/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  for (const path of ['/.env', '/server.js', '/lib/mikrotik.js']) assert.equal((await fetch(url + path)).status, 404);
  for (const path of ['/styles.css', '/app.js', '/favicon.svg']) assert.equal((await fetch(url + path)).status, 200);
});

test('handles malformed and oversized JSON without contacting MikroTik', async t => {
  const { url, state } = await fixture(t);
  for (const [body, status] of [['{', 400], [JSON.stringify({ padding: 'x'.repeat(5000) }), 413]]) {
    const response = await fetch(`${url}/api/change-password`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body });
    assert.equal(response.status, status);
  }
  assert.equal(state.queries.length, 0);
});

test('missing router configuration fails clearly', async () => {
  await assert.rejects(new Mikrotik({}).changePassword(valid), error => error.status === 503);
});
