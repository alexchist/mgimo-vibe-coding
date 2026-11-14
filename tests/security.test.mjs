import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.mjs';

test('independent security boundaries', async (t) => {
  const app = createApp({ databasePath: ':memory:', secureCookies: true });
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(path, { method = 'GET', body, session, headers = {}, rawBody } = {}) {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        ...(body !== undefined || rawBody !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}),
        ...headers,
      },
      ...(rawBody !== undefined ? { body: rawBody } : body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = null; }
    return { res, text, json };
  }
  async function login() {
    const result = await call('/login', { method: 'POST', body: { login: 'alisa@demo.orbita', password: 'Orbita2026!' } });
    assert.equal(result.res.status, 200, result.text);
    const setCookie = result.res.headers.get('set-cookie');
    assert.match(setCookie, /(?:^|;)\s*Secure(?:;|$)/i);
    assert.match(setCookie, /(?:^|;)\s*HttpOnly(?:;|$)/i);
    assert.match(setCookie, /SameSite=Strict/i);
    return { cookie: setCookie.split(';')[0], csrf: result.json.csrfToken };
  }
  try {
    let session;
    await t.test('passwords and session tokens are not stored in plaintext; HTTPS cookies have security flags', async () => {
      session = await login();
      const hashes = app.locals.db.prepare('SELECT password_hash FROM users').all();
      assert.equal(hashes.length, 2);
      assert.notEqual(hashes[0].password_hash, hashes[1].password_hash);
      for (const row of hashes) {
        assert.match(row.password_hash, /^scrypt:/);
        assert.equal(row.password_hash.includes('Orbita2026!'), false);
      }
      const rawToken = session.cookie.substring(session.cookie.indexOf('=') + 1);
      const rows = app.locals.db.prepare('SELECT token_hash FROM sessions').all();
      assert.equal(rows.length, 1);
      assert.notEqual(rows[0].token_hash, rawToken);
      assert.equal(rows[0].token_hash.includes(rawToken), false);
    });

    await t.test('login rejects foreign Origin to prevent login CSRF', async () => {
      const result = await call('/login', {
        method: 'POST', headers: { Origin: 'https://unrelated.invalid' },
        body: { login: 'mark@demo.orbita', password: 'Orbita2026!' },
      });
      assert.equal(result.res.status, 403, result.text);
    });

    await t.test('malformed non-ASCII CSRF token is rejected without a server error', async () => {
      const result = await call('/requests', {
        method: 'POST', session, headers: { 'X-CSRF-Token': 'é'.repeat(64) },
        body: { type: 'enrollment', purpose: 'Для портфолио' },
      });
      assert.equal(result.res.status, 403, result.text);
    });

    await t.test('malformed JSON and invalid payload types produce client errors', async () => {
      const malformed = await call('/requests', { method: 'POST', session, rawBody: '{"type":' });
      assert.equal(malformed.res.status, 400);
      for (const body of [null, [], { type: 'enrollment', purpose: { injected: true } }, { type: 'enrollment', purpose: 'x'.repeat(10000) }]) {
        const result = await call('/requests', { method: 'POST', session, body });
        assert.ok([400, 413, 422].includes(result.res.status), `${JSON.stringify(body).slice(0,60)}: ${result.res.status} ${result.text}`);
      }
    });

    await t.test('idempotency key cannot silently replay a different request', async () => {
      const options = { method: 'POST', session, headers: { 'Idempotency-Key': 'security-different-payload' }, body: { type: 'enrollment', purpose: 'Для портфолио', comment: '' } };
      const first = await call('/requests', options);
      assert.equal(first.res.status, 201, first.text);
      const conflicting = await call('/requests', { ...options, body: { ...options.body, purpose: 'Для другого учреждения' } });
      assert.equal(conflicting.res.status, 409, conflicting.text);
    });

    await t.test('download escapes user-controlled HTML rather than executing it', async () => {
      const payload = '<img src=x onerror=alert(1)> & "test"';
      const created = await call('/requests', { method: 'POST', session, body: { type: 'enrollment', purpose: payload, comment: payload } });
      assert.equal(created.res.status, 201, created.text);
      const id = created.json.request.id;
      for (let i = 0; i < 2; i += 1) {
        assert.equal((await call(`/requests/${id}/demo-advance`, { method: 'POST', session, body: {} })).res.status, 200);
      }
      const doc = await call(`/requests/${id}/document`, { session });
      assert.equal(doc.res.status, 200);
      assert.equal(doc.text.includes('<img src=x'), false);
      assert.ok(doc.text.includes('&lt;img'), 'Purpose should be retained as escaped text, not omitted');
      assert.match(doc.res.headers.get('content-type'), /text\/html/i);
      assert.match(doc.res.headers.get('content-disposition'), /^attachment/i);
      assert.equal(doc.res.headers.get('x-content-type-options'), 'nosniff');
    });

    await t.test('unknown API routes return JSON 404 and private responses disable caching', async () => {
      const missing = await call('/this-route-does-not-exist', { session });
      assert.equal(missing.res.status, 404);
      assert.match(missing.res.headers.get('content-type'), /application\/json/i);
      assert.equal(typeof missing.json?.error, 'string');
      const personal = await call('/bootstrap', { session });
      assert.equal(personal.res.status, 200);
      assert.match(personal.res.headers.get('cache-control'), /no-store/i);
    });

    await t.test('logging in rotates an existing session and invalidates the old token', async () => {
      const previous = session;
      const rotated = await call('/login', {
        method: 'POST', session: previous,
        body: { login: 'alisa@demo.orbita', password: 'Orbita2026!' },
      });
      assert.equal(rotated.res.status, 200, rotated.text);
      session = { cookie: rotated.res.headers.get('set-cookie').split(';')[0], csrf: rotated.json.csrfToken };
      assert.notEqual(session.cookie, previous.cookie);
      assert.notEqual(session.csrf, previous.csrf);
      assert.equal((await call('/session', { session: previous })).res.status, 401);
      assert.equal((await call('/session', { session })).res.status, 200);
    });

    await t.test('expired server session is rejected even with a formerly valid cookie and CSRF token', async () => {
      app.locals.db.prepare('UPDATE sessions SET expires_at = 1').run();
      assert.equal((await call('/session', { session })).res.status, 401);
      assert.equal((await call('/requests', { method: 'POST', session, body: { type: 'enrollment', purpose: 'Для портфолио' } })).res.status, 401);
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    app.locals.close();
  }
});
