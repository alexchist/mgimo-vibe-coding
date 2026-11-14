import express from 'express';
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './database.mjs';
import { REFERENCE_DATE, SEMESTER } from './seed.mjs';

const deriveKey = promisify(scrypt);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COOKIE_NAME = 'orbita_session';
const SESSION_MS = 12 * 60 * 60 * 1000;
const TYPES = {
  enrollment: 'Справка об обучении', scholarship: 'Справка о стипендии',
  transcript: 'Выписка об успеваемости', leave: 'Заявление на академический отпуск',
};
const DUMMY_PASSWORD_HASH = 'scrypt:orbita-demo-alisa-v1:fc48487262107cd74df64ff1ee50efc54cba32b19da49b84a097cb4928e85d21be1c0e33adad77a8a22c92c90aca05f4bec2b1d6f25db88c474d0cd23ad74a9f';
const digest = (value) => createHash('sha256').update(value).digest('hex');
const safeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const htmlEscape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

function cookieToken(req) {
  const item = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`));
  const token = item?.slice(COOKIE_NAME.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}

async function verifyPassword(password, stored) {
  const [algorithm, salt, expected] = stored.split(':');
  if (algorithm !== 'scrypt' || !salt || !expected) return false;
  const actual = await deriveKey(password, salt, 64, { N: 16384, r: 8, p: 1 });
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

/** Create an isolated app instance; tests can pass { databasePath: ':memory:' }. */
export function createApp(options = {}) {
  const db = openDatabase(options.databasePath ?? process.env.DATABASE_PATH ?? path.join(ROOT, 'data/orbita.sqlite'));
  const app = express();
  app.disable('x-powered-by');
  if (options.trustProxy ?? process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  const secureCookies = options.secureCookies ?? process.env.COOKIE_SECURE === 'true';
  const configuredOrigin = options.appOrigin ?? process.env.APP_ORIGIN;
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: secureCookies, path: '/', maxAge: SESSION_MS };
  const loginAttempts = new Map();
  app.locals.db = db;
  app.locals.close = () => db.close();

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    });
    if (secureCookies) res.set('Strict-Transport-Security', 'max-age=31536000');
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '16kb', strict: true }));

  // A browser may only write from this app's origin. CSRF tokens additionally protect authenticated writes.
  app.use('/api', (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    const origin = req.get('origin');
    const requestOrigin = `${req.protocol}://${req.get('host')}`;
    if (origin && origin !== (configuredOrigin || requestOrigin)) {
      return res.status(403).json({ error: 'Запрос с другого сайта запрещён.' });
    }
    if (req.get('sec-fetch-site') === 'cross-site') {
      return res.status(403).json({ error: 'Запрос с другого сайта запрещён.' });
    }
    if (!req.is('application/json')) return res.status(415).json({ error: 'Ожидается запрос в формате JSON.' });
    next();
  });

  const getRecords = (userId, kind) => db.prepare('SELECT payload_json FROM records WHERE user_id = ? AND kind = ?').all(userId, kind).map((row) => JSON.parse(row.payload_json));
  const findRecord = (id, userId, kind) => {
    const row = db.prepare('SELECT payload_json FROM records WHERE id = ? AND user_id = ? AND kind = ?').get(id, userId, kind);
    return row ? JSON.parse(row.payload_json) : null;
  };
  const saveRecord = (userId, kind, record) => db.prepare('UPDATE records SET payload_json = ? WHERE id = ? AND user_id = ? AND kind = ?').run(JSON.stringify(record), record.id, userId, kind);
  const insertRecord = (userId, kind, record) => db.prepare('INSERT INTO records (id, user_id, kind, payload_json) VALUES (?, ?, ?, ?)').run(record.id, userId, kind, JSON.stringify(record));
  const addNotification = (userId, title, body) => insertRecord(userId, 'notifications', {
    id: randomUUID(), title, body, category: 'request', createdAt: new Date().toISOString(), read: false, route: 'requests',
  });

  const authenticate = (req, res, next) => {
    const token = cookieToken(req);
    const session = token && db.prepare(`SELECT s.*, u.profile_json FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`).get(digest(token), Date.now());
    if (!session) return res.status(401).json({ error: 'Войдите в кабинет, чтобы продолжить.' });
    req.session = session;
    req.user = JSON.parse(session.profile_json);
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !safeEqual(req.get('x-csrf-token'), session.csrf_token)) {
      return res.status(403).json({ error: 'Проверка безопасности не пройдена. Обновите страницу.' });
    }
    next();
  };

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', mode: 'fictional-demo' }));

  app.post('/api/login', async (req, res, next) => {
    try {
      const now = Date.now();
      for (const [key, value] of loginAttempts) if (value.expiresAt <= now) loginAttempts.delete(key);
      const ip = req.ip || 'unknown';
      const attempt = loginAttempts.get(ip) || { count: 0, expiresAt: now + 15 * 60 * 1000 };
      if (attempt.count >= 20) {
        res.set('Retry-After', String(Math.ceil((attempt.expiresAt - now) / 1000)));
        return res.status(429).json({ error: 'Слишком много попыток входа. Повторите через 15 минут.' });
      }
      attempt.count += 1;
      loginAttempts.set(ip, attempt);
      const { login, password } = req.body || {};
      if (typeof login !== 'string' || typeof password !== 'string' || login.length > 254 || password.length > 256 || !login.trim() || !password) {
        return res.status(400).json({ error: 'Укажите логин и пароль.' });
      }
      const row = db.prepare('SELECT * FROM users WHERE login = ?').get(login.trim().toLowerCase());
      const correct = await verifyPassword(password, row?.password_hash || DUMMY_PASSWORD_HASH);
      if (!row || !correct) return res.status(401).json({ error: 'Неверный логин или пароль.' });
      // Rotate rather than reusing a session supplied before authentication.
      const oldToken = cookieToken(req);
      if (oldToken) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(oldToken));
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
      const token = randomBytes(32).toString('hex');
      const csrfToken = randomBytes(32).toString('hex');
      db.prepare('INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)')
        .run(digest(token), row.id, csrfToken, now + SESSION_MS);
      loginAttempts.delete(ip);
      res.cookie(COOKIE_NAME, token, cookieOptions);
      res.json({ user: JSON.parse(row.profile_json), csrfToken });
    } catch (error) { next(error); }
  });

  app.get('/api/session', authenticate, (req, res) => res.json({ user: req.user, csrfToken: req.session.csrf_token }));
  app.post('/api/logout', authenticate, (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.session.token_hash);
    res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: undefined });
    res.json({ ok: true });
  });
  app.get('/api/bootstrap', authenticate, (req, res) => {
    const data = { user: req.user, semester: SEMESTER, referenceDate: REFERENCE_DATE };
    for (const kind of ['schedule', 'grades', 'requests', 'notifications', 'deadlines']) data[kind] = getRecords(req.user.id, kind);
    data.requests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    data.notifications.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json(data);
  });

  app.post('/api/requests', authenticate, (req, res) => {
    const { type, purpose, comment = '' } = req.body || {};
    if (typeof type !== 'string' || !Object.hasOwn(TYPES, type)) return res.status(400).json({ error: 'Выберите доступный тип документа.' });
    if (typeof purpose !== 'string' || purpose.trim().length < 3 || purpose.trim().length > 160) return res.status(400).json({ error: 'Укажите цель получения: от 3 до 160 символов.' });
    if (typeof comment !== 'string' || comment.length > 1000) return res.status(400).json({ error: 'Комментарий должен быть не длиннее 1000 символов.' });
    const idempotencyKey = req.get('idempotency-key');
    if (idempotencyKey && !/^[a-zA-Z0-9_-]{8,100}$/.test(idempotencyKey)) return res.status(400).json({ error: 'Некорректный идентификатор отправки.' });
    const normalized = { type, purpose: purpose.trim(), comment: comment.trim() };
    const bodyHash = digest(JSON.stringify(normalized));
    if (idempotencyKey) {
      const previous = db.prepare('SELECT * FROM request_keys WHERE user_id = ? AND key = ?').get(req.user.id, idempotencyKey);
      if (previous) {
        if (previous.body_hash !== bodyHash) return res.status(409).json({ error: 'Этот идентификатор уже использован для другой заявки.' });
        return res.json({ request: findRecord(previous.request_id, req.user.id, 'requests') });
      }
    }
    const count = db.prepare("SELECT COUNT(*) AS n FROM records WHERE user_id = ? AND kind = 'requests'").get(req.user.id).n;
    if (count >= 200) return res.status(429).json({ error: 'Достигнут лимит в 200 демонстрационных заявок для аккаунта.' });
    const now = new Date();
    const at = now.toISOString();
    const estimated = new Date(now);
    let businessDays = 0;
    while (businessDays < 3) {
      estimated.setUTCDate(estimated.getUTCDate() + 1);
      if (estimated.getUTCDay() !== 0 && estimated.getUTCDay() !== 6) businessDays += 1;
    }
    const id = randomUUID();
    const request = {
      id, number: `ОРБ-${id.slice(0, 8).toUpperCase()}`, ...normalized,
      status: 'submitted', createdAt: at, updatedAt: at, estimatedDate: estimated.toISOString().slice(0, 10),
      history: [{ status: 'submitted', at, text: 'Демонстрационная заявка принята. В настоящий деканат ничего не отправлено.' }],
    };
    db.exec('BEGIN IMMEDIATE');
    try {
      insertRecord(req.user.id, 'requests', request);
      if (idempotencyKey) db.prepare('INSERT INTO request_keys (user_id, key, body_hash, request_id) VALUES (?, ?, ?, ?)').run(req.user.id, idempotencyKey, bodyHash, id);
      addNotification(req.user.id, 'Заявка принята', `${TYPES[type]} · ${request.number}. Статус можно проверить в разделе заявок.`);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    res.status(201).json({ request });
  });

  app.get('/api/requests/:id', authenticate, (req, res) => {
    const request = findRecord(req.params.id, req.user.id, 'requests');
    if (!request) return res.status(404).json({ error: 'Заявка не найдена.' });
    res.json({ request });
  });

  app.post('/api/requests/:id/demo-advance', authenticate, (req, res) => {
    const request = findRecord(req.params.id, req.user.id, 'requests');
    if (!request) return res.status(404).json({ error: 'Заявка не найдена.' });
    if (request.status === 'ready') return res.json({ request });
    const at = new Date().toISOString();
    request.status = request.status === 'submitted' ? 'processing' : 'ready';
    request.updatedAt = at;
    const text = request.status === 'ready' ? 'Демонстрационный документ готов. Это не официальный документ.' : 'Демонстрация: заявка взята в работу.';
    request.history.push({ status: request.status, at, text });
    db.exec('BEGIN IMMEDIATE');
    try {
      saveRecord(req.user.id, 'requests', request);
      addNotification(req.user.id, request.status === 'ready' ? 'Документ готов' : 'Заявка в работе', `${request.number} · ${text}`);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    res.json({ request });
  });

  app.get('/api/requests/:id/document', authenticate, (req, res) => {
    const request = findRecord(req.params.id, req.user.id, 'requests');
    if (!request) return res.status(404).json({ error: 'Заявка не найдена.' });
    if (request.status !== 'ready') return res.status(409).json({ error: 'Документ ещё готовится.' });
    res.set('Content-Disposition', `attachment; filename="orbita-demo-${request.id.replace(/[^a-zA-Z0-9-]/g, '')}.html"`);
    res.type('html').send(renderDocument(req.user, request));
  });

  app.post('/api/notifications/read', authenticate, (req, res) => {
    if (req.body?.all === true) {
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const notification of getRecords(req.user.id, 'notifications')) {
          notification.read = true;
          saveRecord(req.user.id, 'notifications', notification);
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return res.json({ ok: true });
    }
    if (typeof req.body?.id !== 'string' || req.body.id.length > 100) return res.status(400).json({ error: 'Выберите уведомление.' });
    const notification = findRecord(req.body.id, req.user.id, 'notifications');
    if (!notification) return res.status(404).json({ error: 'Уведомление не найдено.' });
    notification.read = true;
    saveRecord(req.user.id, 'notifications', notification);
    res.json({ ok: true });
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Такой адрес API не существует.' }));
  const distPath = options.distPath ?? path.join(ROOT, 'dist');
  if (existsSync(path.join(distPath, 'index.html'))) {
    app.use(express.static(distPath, { index: false, maxAge: 0 }));
    app.get(/.*/, (req, res) => {
      if (!req.accepts('html')) return res.status(404).end();
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }
  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Некорректный JSON в запросе.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Запрос слишком большой.' });
    // Do not expose SQL, paths, credentials or stack traces to the browser.
    console.error('Orbita request failed:', error.name || 'Error');
    res.status(500).json({ error: 'Не удалось выполнить запрос. Попробуйте ещё раз.' });
  });
  return app;
}

function renderDocument(user, request) {
  const e = htmlEscape;
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Демонстрационный документ · Орбита</title><style>
body{font:16px/1.7 system-ui,sans-serif;color:#162333;margin:0;background:#f6f7f9}main{max-width:720px;margin:40px auto;background:white;padding:48px;border:2px dashed #147d73}h1{font-size:28px}strong{color:#147d73}.watermark{border:2px solid #b77947;color:#925325;padding:16px;font-weight:700;letter-spacing:.05em}.small{font-size:13px;color:#526272}dl{display:grid;grid-template-columns:150px 1fr;gap:8px}dd{margin:0}@media(max-width:600px){main{margin:12px;padding:24px}dl{display:block}dt{margin-top:12px}}@media print{body{background:white}main{margin:0;border:2px dashed #147d73}}
</style></head><body><main><strong>ОРБИТА · КОНЦЕПТ</strong><p class="watermark">ОБРАЗЕЦ · ВЫМЫШЛЕННЫЕ ДАННЫЕ · НЕ ЯВЛЯЕТСЯ ДОКУМЕНТОМ</p>
<h1>${e(TYPES[request.type])}</h1><p>Демонстрационный макет по заявке ${e(request.number)}.</p>
<dl><dt>Студент</dt><dd>${e(user.fullName)}</dd><dt>Факультет</dt><dd>${e(user.faculty)}</dd><dt>Направление</dt><dd>${e(user.program)}</dd><dt>Курс и группа</dt><dd>${e(user.year)} курс · ${e(user.group)}</dd><dt>Цель</dt><dd>${e(request.purpose)}</dd><dt>Комментарий</dt><dd>${e(request.comment || 'Не указан')}</dd></dl>
<p>Этот файл показывает сценарий получения документа в конкурсном прототипе. Данные вымышлены; сведения об обучении, стипендии, успеваемости или отпуске ничем не подтверждаются.</p>
<p class="small">Орбита — независимый концепт, не официальный сервис МГИМО или другого вуза. Печатей и подписей нет. Макет не имеет юридической силы и не предназначен для предоставления в организации.</p>
</main></body></html>`;
}
