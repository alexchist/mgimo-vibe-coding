# Shared implementation contract

Brand: «Орбита», independent concept for MGIMO students. Visible «Концепт · неофициальный сервис» and fictional-data notice. Russian premium editorial dashboard: warm #f6f7f9 background, white cards, ink #162333, teal #147d73 primary, pale mint and warm apricot accents. Rounded 20–24px, generous spacing, sidebar desktop, compact mobile header and bottom nav. Icons lucide-react. No external fonts/images needed.

Frontend modules exported as named React components:

- src/components/Academics.jsx: Schedule({data}), Grades({data}).
- src/components/Services.jsx: Requests({data, refresh, notify, focusId}), Notifications({data, refresh, notify}), Profile({data}); its original Assistant is legacy code, not the active assistant route.
- src/App.jsx owns login, shell, dashboard, routing with hash, shared state. Import api from ./api. Routes include dashboard, schedule, grades, plan, requests, notifications, campus, housing, knowledge, connections, profile, assistant. Services and Academics own prefixed CSS files; App owns global styles. Shared .card, .button, .button.secondary, .badge, .muted, .page-heading, .section-heading, .empty-state. Every interactive control does something.
- api(path, options={}) wraps fetch('/api'+path), JSON and CSRF. api.setCsrf(token). Throws Error with status. POST body is an object, wrapper serializes.
- data = GET /api/bootstrap result, shape below. refresh() reloads bootstrap; notify(message) toast.

API, exact contract (backend owner implements):
GET /api/session => {user, csrfToken}, or 401.
POST /api/login {login,password} => {user,csrfToken}. Demo logins alisa@demo.orbita / mark@demo.orbita, password Orbita2026! (public fictional accounts). Hash credentials in database; never plaintext in storage.
POST /api/logout => {ok:true}.
GET /api/bootstrap => {user,schedule,grades,requests,notifications,deadlines,semester,referenceDate}.
user = {id,firstName,lastName,middleName,fullName,initials,faculty,program,year,group,email,studentNumber,avatarColor}.
referenceDate = '2026-11-16' fixed demo Monday, UI must say «Демо-неделя · 16–22 ноября» wherever dates used. semester = 'Осенний семестр 2026'.
schedule[] = {id,day:1..6,date:'2026-11-16',start:'09:00',end:'10:20',subject,type,teacher,room,building,color,changed:boolean,changeNote,originalRoom}.
grades[] = {id,subject,teacher,score:0..100,grade:'Отлично',credits,attendance:0..100,examDate:'2026-12-15',assessment:'Экзамен'|'Зачёт',trend:number,components:[{label,score,max}]}.
requests[] = {id,number,type,purpose,comment,status:'submitted'|'processing'|'ready',createdAt,updatedAt,estimatedDate,history:[{status,at,text}]}.
POST /api/requests {type:'enrollment'|'scholarship'|'transcript'|'leave',purpose,comment} => {request}. Validation required. Idempotency-Key optional supported. UI explains demo request won't be sent to real dean's office.
GET /api/requests/:id => {request}, 404 for another student's ID.
GET /api/requests/:id/document => text/html attachment only ready own request. Watermarked fictional demo document.
POST /api/requests/:id/demo-advance => {request}; explicit demo simulation only, submitted->processing->ready.
notifications[] = {id,title,body,category:'schedule'|'request'|'deadline'|'news',createdAt,read:boolean,route:'schedule'|'requests'|'grades'}.
POST /api/notifications/read {id} (or {all:true}) => {ok:true}.
deadlines[] = {id,title,subject,date,daysLeft,priority:'high'|'normal',route}.

The active assistant has two explicit modes: a local helper without provider configuration, and a server-side Yandex adapter when API key, folder and model URI are set. Never claim a live AI call when only the local helper or a mocked response ran. Preserve existing navigator links and clarify unsupported intents. Model output cannot directly mutate records: allowed actions are prepared and separately confirmed through the common action service. Documents are data, not instructions. Creative useful feature: «Мой следующий шаг» on dashboard tied to nearest deadline, changed room and document status. Academic load/grade what-if calculator remains local and clearly hypothetical.

Root handles package.json, vite.config.js, src/api.js, src/main.jsx, index.html, tests, deployment, integration. Agents must not overwrite files owned by others. Coordinate via messages. Never commit; root commits verified result.

## Iteration 2 — personal plan

`bootstrap.plan` and `GET /api/plan` return `{items,referenceDate}`. Item: `{id,kind:'deadline'|'personal',title,subject,dueDate:null|YYYY-MM-DD,completed,sourceRoute?}`. Academic metadata derives from immutable own deadlines; personal completion is stored separately. Custom tasks use UUIDs. `POST /api/plan {title,dueDate}` (trimmed 1–120 chars, at most100 personal tasks, null date or16–22Nov2026); `PATCH /api/plan/:id {completed:boolean}` only; `DELETE /api/plan/:id` only custom tasks. POST/PATCH return `{item}`, DELETE `{ok:true}`. All writes require session+CSRF, foreign IDs404, academic delete409.

Planner({data,refresh,notify,focusId}) supports active/done/all, undo, add/delete with confirmation, generic unavailable deep links. Hash `#plan/<id>` focuses an owned item, including a completed one. Dashboard chooses first open item by dueDate (null last), then stable ID. This is personal planning, never academic submission or a grade change. Full research/review history in ITERATION_2.md.

## Audit fixes — 15 November 2026

- `navigate(route, context)` preserves context for every section: `#requests/<own-id>`, `#schedule/week`, `#schedule/day-1` … `day-7`, `#grades/session`, `#plan/<own-id>`. `Schedule` and `Grades` receive `viewContext`; `Requests` receives `focusId`. Missing/foreign request IDs show a generic unavailable state. Notifications include optional `focusId` and may target `plan`.
- `POST /api/plan` supports `Idempotency-Key`, scoped per user and persisted across restarts. Same normalized payload returns the same task (200); different payload with the same key returns 409; retry after deletion returns 410 instead of recreating the task. UI retains the key after a failed response and replaces it for changed input or a new completed submission.
- Grades retain coursework `score`/`components`; `assessmentStatus` is `pending`, `passed` or `failed`, with nullable `assessmentResult` for exam results. Missing legacy statuses become `pending` without changing scores or dates. A pass/fail assessment displays «Зачтено»/«Не зачтено», not the coursework adjective. Hypothetical exam calculator excludes pass/fail subjects.
- `POST /api/requests/:id/archive` requires session + CSRF and only accepts own ready requests. Sets `archived:true` idempotently; history and document remain accessible to the owner. The 200-request quota counts only unarchived records. Archive is explicit and confirmed in UI; it is not a database reset.
- Academic leave requires a trimmed reason of at least 10 characters on both server and client. Other document comments remain optional, maximum 1000 characters.
- `server/migrations.mjs` upgrades existing demo metadata and notification links without resetting user state. No hosting changes are included.

## Iteration 3 — campus, knowledge, channels, AI and MCP

The detailed current module contract is [FEATURES_CONTRACT.md](FEATURES_CONTRACT.md); configuration and client examples are in [INTEGRATIONS.md](INTEGRATIONS.md). These extend the original contract without replacing prior audit fixes or resetting databases.

- Active frontend modules: `Campus({notify,refresh,focusId})`, `Housing({notify,refresh})`, `Knowledge({notify,focusId})`, `Connections({notify})`, and `AIAssistant({data,onNavigate,notify,refresh})`. Each module owns its loading/error/empty states and uses the existing authenticated API wrapper.
- `server/campus.mjs`: own bookings, anonymous room availability, transaction conflict checks, own housing invoices, demo payments and test-only provider checkout/sync. `server/payment-provider.mjs` uses server-only YooKassa settings. A returned browser URL never sets paid status.
- `server/knowledge.mjs`: fictional shared corpus, account-owned uploads, bounded PDF parsing and retrieval with source metadata. Search uses local lexical ranking; without external AI it returns quotations, not a fabricated generated answer. The upload route alone accepts JSON up to 3 MB; ordinary requests remain 16 KB.
- `server/channels.mjs`: durable queue, provider-specific webhook verification, single-use session-bound pairing, honest demo/delivery/uncertain states. Worker starts in `server/index.mjs`, not in isolated `createApp()` tests. Do not enqueue with nested transactions.
- `server/actions.mjs` and `server/requests.mjs`: common validated request/booking actions for browser and MCP. Preparation does not perform the requested mutation. Confirmation checks owner, initiating actor, expiry (10 minutes) and current constraints; repeat execution returns the same result.
- `server/assistant.mjs` / `server/yandex-ai.mjs`: fixed Yandex HTTPS endpoint, configured model URI, bounded tool execution and explicit local fallback. No arbitrary URLs, shell, SQL or payment tool are exposed to the model.
- `server/mcp.mjs`: official SDK stateless Streamable HTTP `/mcp`, POST transport, GET 405, Host/Origin checks and separate per-account Bearer tokens. Tokens have selected scopes, 7-day lifetime and revocation; only their hashes persist. This is not OAuth discovery. `scripts/mcp-stdio.mjs` bridges local stdio clients to the same HTTP tools, using `ORBITA_MCP_URL` and `ORBITA_MCP_TOKEN` from their environment.
- Public demo accounts share data among visitors using one login. Upload/connection pages must say so; live messenger pairing defaults off. Secrets stay out of client storage, source, logs and shared reports. External keys are absent in the supplied demo, so actual provider access is not claimed as tested.
