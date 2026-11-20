# Постановки задач агентам и обратная связь

Это выдержки из фактических задач в сессии Codex, а не выдуманный диалог. Общий полный контракт находится в `CONTRACT.md`, инструкции для дальнейшей работы — в корневом `AGENTS.md`.

## Анализ и координация

> You are project coordinator + business analyst + creative lead. Read /workspace/mgimo-vibe-coding/docs/assignment.txt, AGENTS.md, docs/CONTRACT.md. Own docs/PRODUCT.md and docs/PROCESS.md only. Build thorough but concise competition rubric mapping, user scenarios, meaningful creative differentiators and evidence collection plan. Document real multi-agent process/prompts honestly; no invented interviews or claims of tests. Coordinate with other named agents by messages as helpful; inspect progress later and identify omissions to root. Russian documents. Must include exact submission checklist and video storyboard <5min. Do not modify source/package files. Need working prototype, not just plan. Send actionable findings promptly. Read actual tool results before asserting facts.

Аналитик выделил риск недоказанной публичной доступности и уточнил, что 28 ноября — срок доступности до итогов, а не указанный в тексте дедлайн подачи. Это отражено в документации.

## Сервер и безопасность

> Implement full secure backend in /workspace/mgimo-vibe-coding/server/* only. Read AGENTS.md and docs/CONTRACT.md EXACT API. Node24 Express and node:sqlite DatabaseSync (no third party db dependency). SQLite data/ persistent, injectable DATABASE_PATH and PORT, server export createApp or similar for tests; server/index.mjs runs production static dist and Vite dev proxy uses port3001. Two fictional users public demo credentials contract, all data per user, scrypt password hashes (prefer seeded hardcoded derived hash constants so no plaintext password stored); HttpOnly SameSite session cookies crypto random hash in DB, CSRF token for writes, Origin check, login rate limit, expiration, security headers, request input validation, own-resource 404.

Продолжение задания включало отдельные расписания и оценки, историю заявок, идемпотентность, экранирование скачиваемого HTML и явную маркировку демосимуляции.

Реальная интеграционная обратная связь серверного агента: все POST требуют JSON, включая logout и demo-advance. После этого общий `api.js` стал автоматически отправлять пустой JSON-объект для запросов изменения без тела.

## Дизайн и главная

> You are UI designer + frontend lead. Implement src/App.jsx, src/styles.css ONLY in /workspace/mgimo-vibe-coding. Read AGENTS.md and docs/CONTRACT.md exact imports/components/data. Build beautiful Russian polished responsive app login + sidebar/nav shell + dashboard. Design must feel excellent: editorial typography, off-white, teal/mint/apricot, purposeful asymmetrical card dashboard, own orbital CSS/SVG mark, attractive welcome hero with vector orbital motif (no stock/official assets), clean whitespace, icons lucide-react.

Дополнительные требования: обе демоучётки на входе, действующие маршруты, реальные данные API, уведомления, видимый фокус, доступность на 360 px и фиксированная подписанная демо-неделя.

## Расписание и успеваемость

> Schedule: today/week tabs, days, times/teacher/rooms, clear changed lesson original vs updated details, functional filters, empty states, readable 360px cards, useful ICS download (escape/valid calendar; fixed demo Nov16 week indicated). Grades: overview weighted score/attendance/status, subjects and assessment/session dates, expandable grade components, functional hypothetical goal calculator if sensible with honest assumptions.

Ревью выявило экспорт `TZID=Europe/Moscow` без определения `VTIMEZONE`. Агент заменил время событий на UTC с явным переводом из московского времени. Это фактическое улучшение совместимости, а не косметическое изменение.

## Заявки и локальный навигатор

> Requests polished type selection form purpose/comment validation, submit persisted API, prevent double-submit, list requests, detail history/status/expected date, explicit 'Демо: следующий этап' POST simulation and downloadable only ready document via API link (plain download request GET no csrf). Visible demo not sent real office. Notifications filters and mark read/all, actionable navigation hash. Profile rich exact fictional data accessible. Assistant local intent navigator NO external AI claims; input handles schedule/grades/deadlines/documents using actual user data with useful action links, suggested queries, transparent label local navigator.

Реальные замечания тимлида: тип `leave` показывался как произвольный вопрос, а сервер готовил заявление на академический отпуск; сроки 2/3/5 дней не соответствовали серверным трём рабочим дням. Исправлены названия, пояснения и сроки. Успешное создание заявки отделено от возможной ошибки последующего обновления списка, чтобы интерфейс не предлагал повторную отправку уже принятой заявки.

Ревьюер также заметил: запрос о ближайшем экзамене возвращал средний балл, а запрос о среде — понедельник. Навигатор получил явные обработчики экзаменов и дней недели.

## Независимая проверка

> Role: research existing student portal best practices + independent reviewer/test designer. Read /workspace/mgimo-vibe-coding/docs/assignment.txt AGENTS.md CONTRACT. Own docs/RESEARCH.md and docs/REVIEW.md only, no application edits initially. Research via public official pages using curl if browser tools unavailable; fetch safely no credentials (Canvas Student, Moodle dashboard, UK university student portal or WCAG official). Explain applicable patterns with source links and explicitly distinguish observed vs inferred, avoid invented research.

После готовности API ревьюеру выделен отдельный файл тестов для проверки хранения хешей, Secure-cookie, CSRF, истечения и ротации сессий, повторной заявки с другим телом и неизвестных API-адресов. Координатор получил дополнительную роль тестировщика и отдельное владение браузерными сценариями.

## Развёртывание

Серверный агент при ревью Dockerfile обнаружил реальные права доступа 0700/0600 у исходников: после COPY от root процесс под `USER node` не смог бы прочитать сервер. Добавлен `COPY --chown=node:node` для файлов среды исполнения. Docker Compose и конфигурация HTTPS проверяются отдельно от реального размещения.

## Принцип работы команды

Области владения файлами не пересекались; общий контракт уменьшал риск несовместимых интерфейсов. Исправления направлялись владельцу модуля, а тимлид повторно проверял интеграцию. Успешный ответ агента не считался заменой выполненного теста. Итоговые результаты и реальные изображения находятся в `PROCESS.md`, `REVIEW.md` и `screenshots/`.

## Аудит и исправления — 15 ноября 2026

Дословный запрос пользователя:

> Соверши аудит этого проекта, найди слабые места и за что можно снять баллы по критериям

Основной агент прочитал критерии, выполнил тесты и дополнительные проверки в браузере. В частности, вопрос «Какой срок изготовления справки?» возвращал срок эссе; вопрос «Какие пары завтра?» — понедельник; вопрос «Какой у меня ближайший экзамен по английскому?» — экзамен по истории. Потерянный после сохранения ответ API привёл к дубликату личной задачи. В PDF обнаружено отсутствие кликабельных ссылок. Это наблюдения по работающему приложению, не выдуманные отзывы студентов.

Следующий дословный запрос пользователя:

> Исправь эти баги кроме хостинга

Решения агента: адресные переходы для заявок, расписания и сессии; разбор конкретного намерения и предмета в локальном навигаторе; сохраняемые ключи повторных операций; отдельный результат аттестации; архив готовых заявок без удаления истории; серверная проверка причины отпуска; самостоятельный PDF с сохранёнными промптами и абсолютными ссылками. Новая делегация субагентам в этом этапе не применялась.

Доказательства проверяются в `tests/audit.test.mjs` (повтор после перезапуска, чужие аккаунты, лимит, миграция старой базы, запросы навигатору) и `tests/e2e/audit.spec.js` (реальные переходы, потеря ответа, мобильный архив, результат зачёта). Результаты команд приведены в текущем дополнении `PROCESS.md`, без приписывания проверок, которые ещё не выполнены.

## Пять направлений расширения — 15 ноября 2026

Дословные пункты нового запроса пользователя:

> Какие фичи я хочу добавить:
>
> 1. уведомления о каких-то изменениях в тг/вк
> 2. подобие https://mipt.tech/ чтобы можно было резервировать какие-то общественные помещения, оплачивать общагу
> 3. mcp сервер, чтобы человек мог наблюдать за своим расписание/бронировать помещения и тп через свою нейронку
> 4. rag систему каких-то внутренних документов. Чтобы можно было легко искать какую-то внутреннюю информацию по приказам и тп
> 5. ИИ ассистента (скорее всего, добавим через yandex ai какого-нибудь qwen), чтобы можно было прям ему писать запрос типа Какое у меня завтра расписание, Закажи справку по чему-либо, в общем, как на госуслугах
>
> Попытайся это всё реализовать. Посмотри как писал прошлый агент (у него были субагенты, которые выполняли какие-то роли) и сделай так же

Агент уточнил наличие подключений и предложил пока реализовывать адаптеры с явно обозначенным деморежимом без реальных списаний. Ответ пользователя: **«Пока ничего нет — готовим подключения»**. На выбор настоящих документов или учебной базы с загрузкой через интерфейс пользователь ответил: **«Демобаза и загрузка документов»**.

Основной агент применил делегацию шести ролям: исследование, кампус, каналы, документы, помощник, независимое ревью. Постановки в пересказе, не дословная стенограмма: исследовать первичные источники; реализовать каждый модуль в закреплённых файлах; держать данные в SQLite и проверять владельца на сервере; отделить demo от реальных провайдеров; сохранить прежние сценарии кабинета; проверить интеграцию HTTP/SDK/браузером. Конкретные signatures и границы файлов зафиксированы в [FEATURES_CONTRACT.md](FEATURES_CONTRACT.md).

Примеры реально переданной обратной связи: исследователь уточнил новый endpoint Yandex и ограничение MCP Bearer без OAuth; критик потребовал проверять слот уже при подготовке и повторно при подтверждении; основной агент обнаружил опасный для большого файла base64-regex и предложил линейную проверку; агент документов перенёс PDF в ограниченные workers; критик отметил неопределённую доставку при отключении канала во время запроса; после axe-проверок исправлены подписи и контраст. Результаты и ограничения отражены в [PROCESS.md](PROCESS.md) и [FEATURES_REVIEW.md](FEATURES_REVIEW.md).

## GigaChat и расписание, 20 ноября 2026

Пользователь привёл три примера из кабинета. Вопрос о преподавателе по географии показывал расписание дня, «сколько будет 2 + 1» запускало поиск документов, а «напиши 5» возвращало перечень разделов. Пользователь попросил улучшить ветку `feat/orbita-student-portal` по образцу `kursom-jury-2026-11-20` и отдельно уточнил, что арифметику должна выполнять модель.

Из коммита жюри `aa2355e` взяли обработку московской даты и двух демонстрационных недель. Для общих вопросов добавили отдельный запрос к GigaChat и вывод текста модели. Для сведений о кабинете сохранили проверку источников. Поиск преподавателей использует дисциплины и занятия текущего аккаунта.

На изолированных данных прошли сборка `npm run build`, 134 теста `npm test` и 60 браузерных сценариев `npm run test:e2e`. В браузере проверялись обе кнопки отправки, источник ответа и переход к преподавателю. В тестах GigaChat используются подставленные ответы OAuth и модели. Запросы к рабочему GigaChat и публикация на сервере в эту проверку не входили.
