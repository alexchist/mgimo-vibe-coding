# Shared implementation contract

Brand: «Орбита», independent concept for MGIMO students. Visible «Концепт · неофициальный сервис» and fictional-data notice. Russian premium editorial dashboard: warm #f6f7f9 background, white cards, ink #162333, teal #147d73 primary, pale mint and warm apricot accents. Rounded 20–24px, generous spacing, sidebar desktop, compact mobile header and bottom nav. Icons lucide-react. No external fonts/images needed.

Frontend modules exported as named React components:
- src/components/Academics.jsx: Schedule({data}), Grades({data}).
- src/components/Services.jsx: Requests({data, refresh, notify}), Notifications({data, refresh, notify}), Profile({data}), Assistant({data, onNavigate}).
- src/App.jsx owns login, shell, dashboard, routing with hash, shared state. Import api from ./api. Sidebar routes dashboard, schedule, grades, requests, notifications, profile, assistant. Services and Academics own prefixed CSS files; App owns global styles. Shared .card, .button, .button.secondary, .badge, .muted, .page-heading, .section-heading, .empty-state. Every interactive control does something.
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

Do not invent actual AI backend. Assistant is a transparent local navigator: predefined intents from user's actual data, links to appropriate routes, disclaimer «Навигатор по вашим данным · без внешнего ИИ». Creative useful feature: «Мой следующий шаг» on dashboard tied to nearest deadline, changed room and document status. Academic load/grade what-if calculator can be local and clearly hypothetical.

Root handles package.json, vite.config.js, src/api.js, src/main.jsx, index.html, tests, deployment, integration. Agents must not overwrite files owned by others. Coordinate via messages. Never commit; root commits verified result.

## Iteration 2 — personal plan

`bootstrap.plan` and `GET /api/plan` return `{items,referenceDate}`. Item: `{id,kind:'deadline'|'personal',title,subject,dueDate:null|YYYY-MM-DD,completed,sourceRoute?}`. Academic metadata derives from immutable own deadlines; personal completion is stored separately. Custom tasks use UUIDs. `POST /api/plan {title,dueDate}` (trimmed 1–120 chars, at most100 personal tasks, null date or16–22Nov2026); `PATCH /api/plan/:id {completed:boolean}` only; `DELETE /api/plan/:id` only custom tasks. POST/PATCH return `{item}`, DELETE `{ok:true}`. All writes require session+CSRF, foreign IDs404, academic delete409.

Planner({data,refresh,notify,focusId}) supports active/done/all, undo, add/delete with confirmation, generic unavailable deep links. Hash `#plan/<id>` focuses an owned item, including a completed one. Dashboard chooses first open item by dueDate (null last), then stable ID. This is personal planning, never academic submission or a grade change. Full research/review history in ITERATION_2.md.
