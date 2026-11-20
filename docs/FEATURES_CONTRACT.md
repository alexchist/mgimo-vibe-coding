# Итерация 3 — кампус, подключения и помощник

Пользователь запросил Telegram/VK, бронирование помещений и оплату общежития, MCP, поиск по внутренним документам и ИИ-помощника с Yandex AI. Подтверждено: внешних подключений пока нет; нужны адаптеры и явно обозначенный деморежим, демобаза документов и загрузка своих файлов. Реальные списания, рассылки и публикация не выполняются. Предыдущие незакоммиченные исправления аудита сохраняются.

## Общие правила интеграции

Node 24 / Express / SQLite; React. Корневой агент владеет `server/app.mjs`, `server/database.mjs`, `server/index.mjs`, `src/App.jsx`, `src/api.js`, package-файлами, `.env.example`, общим сервисом действий и MCP. Остальные агенты создают только свои модули. Установщики модулей создают свои таблицы через `CREATE TABLE IF NOT EXISTS`, не сбрасывают базу. Сервисы получают `userId` от доверенного серверного контекста, не из тела запроса. Ошибки в сервисах — `Error` с безопасным русским message и числовым `status`; корневой обработчик возвращает соответствующий JSON. Все private HTTP routes используют переданный `authenticate`, включая CSRF на изменениях. Возвращаемые функции сервисов синхронны, если не нужен внешний запрос/PDF; вызывающий код может всегда await.

`notify(userId, {id?,title,body,category,route,focusId?})` сохраняет уведомление и ставит его в очередь каналов. Не запускать вложенные транзакции в notify/enqueue. Не передавать чужие ФИО в занятости помещения. Расписание, бронирования и даты личных дел привязаны к демо-неделе 16–22 ноября 2026. «Сегодня» и относительные даты считаются по Москве. В `GET /api/bootstrap` поле `todayDate` содержит текущую московскую дату, а `referenceDate` сохраняет начало демо-недели для совместимости.

## Кампус — владелец campus

`installCampus(app, db, authenticate, {notify, ...options})` из `server/campus.mjs` возвращает:

- `listRooms(userId,{date}={}) -> {rooms,referenceDate}`; room `{id,name,building,capacity,amenities,description}`.
- `availability(userId,{roomId,date}) -> {room,date,slots:[{start,end,available}]}`.
- `listBookings(userId) -> {bookings}`; booking `{id,roomId,roomName,date,start,end,purpose,status:'confirmed'|'cancelled'}`.
- `createBooking(userId,{roomId,date,start,end,purpose},idempotencyKey) -> {booking}`; сервер проверяет пересечения в транзакции.
- `cancelBooking(userId,id) -> {booking}`.
- `getHousing(userId) -> {account,invoices,payments,mode}`; суммы в рублях/копейках явно подписаны.
- `payDemo(userId,invoiceId,idempotencyKey) -> {invoice,receipt}` — только маркированная демооплата, без ввода банковской карты.

Routes: GET `/api/campus/rooms`, GET `/api/campus/availability?roomId=&date=`, GET/POST `/api/campus/bookings`, POST `/api/campus/bookings/:id/cancel`, GET `/api/housing`, POST `/api/housing/invoices/:id/demo-pay`. При реализации YooKassa — только явно включаемый sandbox/test adapter; root установит необходимые env; не принимать успешность оплаты от браузера.

Frontend: `Campus({notify})`, `Housing({notify})` из `src/components/Campus.jsx`, собственный `campus.css`, внутренний api import. Shell routes `campus`, `housing`. Собственные API и тесты `tests/campus.test.mjs`.

## Документы — владелец knowledge

`installKnowledge(app,db,authenticate,options={})` из `server/knowledge.mjs` возвращает:

- `search(userId,query,{limit=5}={}) -> {query,sources,hasResults}`; source `{documentId,chunkId,title,section,quote,score,fictional,version,updatedAt}`.
- `listDocuments(userId) -> {documents}`; `getDocument(userId,id) -> {document}`.
- `importDocument(userId,{title,text?,pdfBase64?,fileName?}) -> {document}`; `deleteDocument(userId,id)`.

Routes: GET `/api/knowledge/search?q=`, GET/POST `/api/knowledge/documents`, GET/DELETE `/api/knowledge/documents/:id`. Демо-документы общие, импортированные документы приватны владельцу; общий контент студент не редактирует. Root увеличивает JSON limit только upload route до 3mb; остальные 16kb. TXT/MD и PDF с текстовым слоем (pdf-parse dependency root). Поиск SQLite FTS/BM25 или проверяемое ранжирование; без внешнего провайдера — цитаты, не выдуманный сгенерированный ответ. Включённый AI использует эти источники для RAG. Frontend `Knowledge({notify,focusId})` из `src/components/Knowledge.jsx`, `knowledge.css`; route `knowledge`. Тесты `tests/knowledge.test.mjs`.

## Каналы — владелец channels

`installChannels(app,db,authenticate,options={})` из `server/channels.mjs` возвращает `enqueue(userId,event)` (только SQL insert, может вызываться внутри чужой транзакции), `flush()` async, `close()` и по необходимости `start()`. Root вызывает worker только из server/index; test createApp сам не рассылает. Outbox сохраняется в SQLite, имеет защиту от дублей, ограниченные ретраи и журнал статусов. Нет ключей => деморежим, никогда не писать «доставлено в Telegram» о локальной записи.

Routes contract на усмотрение владельца, немедленно документировать и сообщить root. UI и backend в одной области владения: `src/components/Connections.jsx`, `connections.css`, export `Connections({notify})`, shell route `connections`. Telegram/VK настраиваются серверными env, личный канал связывается одноразовым истекающим кодом из входящего сообщения (проверенный webhook secret), не произвольным recipient ID в форме. Без конфигурации доступно маркированное демоподключение и просмотр локального журнала. Привязка настоящего канала отключена для публичных демоаккаунтов по умолчанию, включается явной серверной настройкой. Тесты не отправляют внешних сообщений.

На той же странице UI для MCP токенов, root предоставляет: GET `/api/mcp/tokens` -> `{tokens:[{id,name,scopes,createdAt,expiresAt,lastUsedAt}],availableScopes,endpoint}`; POST `{name,scopes}` -> `{token,record,endpoint}` (секрет один раз, только state, не browser storage); DELETE `/api/mcp/tokens/:id` -> `{ok:true}`. Scopes: `profile:read`, `schedule:read`, `bookings:read`, `bookings:write`, `housing:read`, `requests:write`, `knowledge:read`. Примеры JSON конфигурации без фиктивного успешного подключения. Токены живут 7 дней, хранятся хешами.

## Ассистент — владелец assistant

`installAssistant(app,db,authenticate,{campus,knowledge,actions,getRecords,...options})` из `server/assistant.mjs`; `getRecords(userId,kind)` возвращает записи текущего владельца. Подключение Yandex OpenAI-compatible API серверное (`YANDEX_API_KEY`, `YANDEX_FOLDER_ID`, `YANDEX_MODEL_URI`), ограничение длины и таймаут, safe fallback с явным предупреждением. Секреты не выходят в bootstrap. Модель и документы не получают права исполнять произвольные команды. Доступные функции/действия строго перечислены; документ — недоверенные данные, не инструкции.

Root даёт `actions.prepare(userId,{type,params},{actorId='browser'}={}) -> {action:{id,type,summary,params,expiresAt,status}}`, `actions.confirm(userId,id,{actorId='browser'}={}) -> {action,result}`, `actions.list(userId,{actorId='browser'}={}) -> {actions}`. Types: `request.create` params `{type,purpose,comment?}`, `booking.create` params `{roomId,date,start,end,purpose}`, `booking.cancel` params `{bookingId}`. Подготовка не изменяет заявки/брони. Подтверждение привязано к владельцу/actor, одноразовое и повторобезопасное; истечение 10 минут. Неполные данные вызывают уточнение, не домыслы. Оплата через модель запрещена, можно дать ссылку на раздел.

Routes GET `/api/assistant/status`, POST `/api/assistant/chat` `{message,conversationId?,shareQuestion?,history?}` -> `{reply,mode,sources?,action?,links?}`; POST `/api/assistant/actions/:id/confirm` -> shared actions result. При отсутствии ключей режим честно назван локальным демопомощником, но простые запросы расписания, поиска и подготовки заявки/брони работают.

При `shareQuestion: true` режим `gigachat` формирует ответ по описаниям разделов и фрагментам общих демодокументов. Сервер проверяет идентификаторы источников и сам строит ссылки на разделы и документы. По `conversationId` доступен один короткий предыдущий вопрос с проверкой владельца и срока диалога. Передавать его провайдеру можно только если предыдущий вопрос уже был обработан с разрешения пользователя. История из тела запроса поддерживается для совместимости и не передаётся провайдерам. Поиск по загруженным файлам и ответы по записям аккаунта выполняются локально. В сгенерированном ответе поле `model` содержит идентификатор модели из ответа провайдера. При сбое или исчерпании квоты сервер возвращает `mode: "local"` с пояснением.

Frontend `AIAssistant({data,onNavigate,notify,refresh})` из `src/components/AIAssistant.jsx` + `ai-assistant.css`; shell route `assistant` заменяет старый Assistant, но сохраняет привычные примеры вопросов и точные переходы (старые тесты ожидают кнопки «Как заказать справку?», «Какой ближайший дедлайн?», «Открыть заявки», «Открыть дело в плане» и лог ответов). Тесты `tests/assistant.test.mjs`; provider injectable fetch для проверки без внешних вызовов.

## MCP и интеграция — root

Настоящий MCP Streamable HTTP `/mcp` через официальный SDK, Bearer с per-user scopes, сроком и отзывом; stateless transport. Список инструментов: своё расписание, комнаты/доступность/свои брони, жилищные начисления, поиск документов, подготовка заявки/брони/отмены, подтверждение подготовленного действия. Записи только после явного подтверждения пользователя; tool annotations и инструкции отражают это. Root связывает общий actions service с действующими HTTP-сценариями и с MCP. Внешнее подключение к локальному серверу требует пользовательского адреса/HTTPS позже; не объявлять опубликованным.

## Проверка — reviewer

Независимые проверки новых границ после реализации: подстановка userId и чужих ID, пересечения бронирований, повторная оплата в демо, приватность поиска, повреждённый PDF, права MCP токена/отзыв/Origin, подмена webhook и pairing-кода, модель не исполняет неподтверждённые действия. E2E desktop/mobile с изолированной тестовой базой, без реальных рассылок и платежей. Владение `tests/e2e/features.spec.js`, `tests/features-security.test.mjs`, `docs/FEATURES_REVIEW.md`; вначале замечания по контракту, потом реализация проверок. Не ослаблять старые тесты ради успеха.
