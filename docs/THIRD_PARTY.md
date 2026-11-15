# Сторонние материалы и лицензии

В интерфейсе нет сторонних фотографий, официальной символики вуза или удалённых шрифтов. Используются системные шрифты; орбитальный знак и иллюстрация созданы кодом для этого проекта. Код Moodle/Canvas/WCAG не копировался — ссылки приведены как источники принципов.

| Пакет                     | Версия  | Лицензия   | Назначение                                      |
| ------------------------- | ------- | ---------- | ----------------------------------------------- |
| react                     | 19.3.1  | MIT        | Интерфейс                                       |
| react-dom                 | 19.3.1  | MIT        | Рендеринг интерфейса                            |
| express                   | 5.3.0   | MIT        | HTTP-сервер                                     |
| lucide-react              | 0.468.0 | ISC        | Иконки                                          |
| @modelcontextprotocol/sdk | 1.32.2  | MIT        | MCP Streamable HTTP сервер и stdio-мост         |
| zod                       | 4.6.7   | MIT        | Схемы параметров MCP-инструментов               |
| pdf-parse                 | 2.4.5   | Apache-2.0 | Извлечение текста из загруженного PDF           |
| pdfjs-dist                | 5.4.296 | Apache-2.0 | Транзитивный PDF-парсер, используемый pdf-parse |
| vite                      | 7.3.8   | MIT        | Сборка                                          |
| @vitejs/plugin-react      | 5.2.0   | MIT        | Сборка React                                    |
| @playwright/test          | 1.65.1  | Apache-2.0 | Браузерные тесты и PDF                          |
| marked                    | 18.2.0  | MIT        | Преобразование Markdown отчёта                  |
| @axe-core/playwright      | 4.14.0  | MPL-2.0    | Проверка доступности                            |

Прямые и транзитивные зависимости зафиксированы в package-lock.json. Оригинальные лицензии сохраняются в устанавливаемых npm-пакетах. Node.js — MIT (и лицензии включённых компонентов); SQLite — public domain; Caddy — Apache-2.0. Chromium используется для тестов и подготовки снимков (BSD и лицензии компонентов).

Версии и лицензии новых пакетов сверены с установленными `package.json` 15 ноября 2026 года. Источники API Yandex, Telegram, VK, YooKassa, MCP и открытая страница MIPT.Tech использовались для исследования, их код, логотипы и интерфейсы в проект не переносились. Ссылки и границы проверки — в [FEATURES_RESEARCH.md](FEATURES_RESEARCH.md). Демонстрационные тексты правил созданы для «Орбиты» и не выданы за реальные приказы. Доступ к внешним API регулируется условиями провайдеров и не предоставляется лицензией нашего кода; ключи и реальные подключения в репозитории отсутствуют.

Prettier 3.10.1 — MIT; используется для форматирования исходного кода. FFmpeg используется только для подготовки видео; лицензии компонентов доступны в установленной сборке (`ffmpeg -L`), само приложение FFmpeg не распространяет.

## Lucide

```text
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

```
