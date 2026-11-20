import { createHash, randomUUID } from "node:crypto";
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";

const MAX_TEXT = 100_000;
const MAX_PDF_BYTES = 2 * 1024 * 1024;
const MAX_DOCUMENTS = 30;
const MAX_ACCOUNT_TEXT = 500_000;
const MAX_PAGES = 80;
const fail = (status, message) =>
  Object.assign(new Error(message), { status, expose: true });
const stopWords = new Set(
  "а без бы был была были было быть в вам вас ваш ваша ваши во все всего вы где да для до его ее если есть еще за и из или им их к как какая какие какой когда кто ли мне может можно мы на над надо наш не него нет ни но о об один он она они оно от по под после при про с со так также там те тем то того только тут у уже что чтобы это эта эти этого я меня моего моей свой свои какой-то".split(
    " ",
  ),
);

function normalizeText(text) {
  return text
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("\0", "")
    .normalize("NFC")
    .trim();
}
function terms(text) {
  const words =
    text
      .toLocaleLowerCase("ru")
      .replaceAll("ё", "е")
      .match(/[\p{L}\p{N}]+/gu) || [];
  return words
    .filter((word) => word.length > 1 && !stopWords.has(word))
    .map((word) => {
      if (/^(общежит|общаг)/.test(word)) return "общежит";
      if (/^(брони|бронь|заброн|резерв)/.test(word)) return "бронь";
      if (/^(оплат|оплач|платеж|заплат)/.test(word)) return "оплат";
      if (/^(справк|справок)/.test(word)) return "справк";
      if (/^(готов|подготов)/.test(word)) return "готов";
      if (/^(день|дня|дни|дней)/.test(word)) return "день";
      if (/^стипенд/.test(word)) return "стипенд";
      if (word.length < 5) return word;
      return word.replace(
        /(иями|ями|ами|ого|его|ему|ому|иях|ать|ить|ять|ах|ях|ий|ый|ой|ая|яя|ое|ее|ые|ие|ов|ев|ам|ям|ом|ем|ую|юю|а|я|ы|и|у|ю|е|о)$/u,
        "",
      );
    });
}
function chunksFor(text) {
  const sections = [];
  let heading = "";
  const paragraphs = text.split(/\n\s*\n|\n(?=\s*(?:#{1,6}\s|\d+[.)]\s))/u);
  for (const paragraph of paragraphs) {
    let content = paragraph.trim();
    if (!content) continue;
    const headingMatch = content.match(/^#{1,6}\s+([^\n]+)(?:\n|$)/);
    if (headingMatch) {
      heading = headingMatch[1].slice(0, 160);
      content = content.slice(headingMatch[0].length).trim();
      if (!content) continue;
    }
    const number = content.match(/^(\d+(?:\.\d+)*[.)])\s/);
    const section = number
      ? `Пункт ${number[1].replace(/[.)]$/, "")}`
      : heading || `Фрагмент ${sections.length + 1}`;
    // Keep quotations bounded without splitting a sentence when possible.
    while (content.length) {
      let end = Math.min(content.length, 1400);
      if (content.length > end) {
        const boundary = Math.max(
          content.lastIndexOf(". ", end),
          content.lastIndexOf("\n", end),
          content.lastIndexOf(" ", end),
        );
        if (boundary > 700) end = boundary + 1;
      }
      const quote = content.slice(0, end).trim();
      if (quote) sections.push({ section, text: quote });
      content = content.slice(end).trim();
    }
  }
  return sections;
}

const demos = [
  {
    id: "demo-room-rules",
    title: "Правила бронирования общественных помещений",
    version: "Демо-редакция 1 от 15.11.2026",
    text: "# Правила бронирования общественных помещений\n\nВымышленный документ для конкурсного прототипа «Орбита». Не является приказом университета.\n\n1. Бронирование доступно на демонстрационную неделю 16–22 ноября 2026 года. Помещения работают с 09:00 до 21:00 по московскому времени.\n\n2. Начало и окончание брони выбираются с шагом 30 минут. Продолжительность — от 30 до 120 минут. На одного студента допускается не более трёх активных броней в день.\n\n3. Перед бронированием нужно выбрать помещение, дату, время и указать цель. Если интервал уже занят, сервер отклонит пересекающуюся бронь. Данные других посетителей в календаре занятости не показываются.\n\n4. Отменить свою бронь можно в разделе «Кампус», в списке своих бронирований. После отмены время освобождается. Чужую бронь отменить нельзя.\n\n5. Доступность оборудования и вместимость указаны в карточке помещения. Бронирование в прототипе не предоставляет доступ к реальным помещениям университета.",
  },
  {
    id: "demo-housing-policy",
    title: "Порядок оплаты общежития",
    version: "Демо-редакция 1 от 15.11.2026",
    text: "# Порядок оплаты общежития\n\nВымышленный документ для конкурсного прототипа «Орбита». Не устанавливает реальные тарифы и обязательства.\n\n1. Начисления за проживание доступны в разделе «Общежитие». Сумма, период и срок оплаты указаны в каждой карточке счёта. Демо-счёт за ноябрь 2026 года нужно оплатить до 25 ноября 2026 года.\n\n2. Кнопка демонстрационной оплаты изменяет только состояние вымышленного счёта. Настоящие деньги не списываются, банковскую карту вводить не нужно. Повторное подтверждение не создаёт второй платёж по уже оплаченному счёту.\n\n3. После успешной демооплаты в кабинете сохраняется учебная квитанция. Она не является банковским подтверждением или официальным платёжным документом.\n\n4. При подключении тестового платёжного провайдера следует использовать только его тестовый режим. Переход обратно в кабинет сам по себе не подтверждает оплату: сервер должен проверить статус у провайдера.\n\n5. Счёт, платежи и квитанции доступны только владельцу аккаунта. Публичные демонстрационные логины предназначены для проверки на вымышленных данных.",
  },
  {
    id: "demo-document-orders",
    title: "Порядок выдачи справок и подачи заявлений",
    version: "Демо-приказ № 03 от 15.11.2026",
    text: "# Порядок выдачи справок и подачи заявлений\n\nДемонстрационный приказ № 03. Все сведения вымышлены; это не официальный документ университета.\n\n1. В разделе «Заявки и справки» можно заказать справку об обучении, справку о стипендии, выписку об успеваемости или подать заявление на академический отпуск.\n\n2. Для справки нужно указать, куда её предоставить. Демонстрационный срок подготовки документа — три рабочих дня после подачи заявки. Ориентировочная дата и история обработки отображаются в карточке заявки.\n\n3. Для заявления на академический отпуск дополнительно требуется вымышленная причина длиной не менее десяти символов. Не вводите медицинские сведения и другие реальные персональные данные.\n\n4. Когда статус изменится на «Документ готов», владелец может скачать маркированный учебный образец. Кнопка «Демо: следующий этап» имитирует обработку сотрудником. Настоящее заявление в университет не направляется.\n\n5. Готовую заявку можно перенести в архив. История и скачивание сохраняются; заявка освобождает место в лимите двухсот обращений вне архива.",
  },
  {
    id: "demo-assessment-policy",
    title: "Учебный регламент: сессия и результаты аттестации",
    version: "Демо-редакция 1 от 15.11.2026",
    text: "# Учебный регламент: сессия и результаты аттестации\n\nВымышленный учебный регламент. Не заменяет официальные правила университета.\n\n1. Текущий балл складывается из семинаров, контрольных работ и проекта. Высокий текущий балл сам по себе не означает сдачу экзамена или получение зачёта.\n\n2. Результат аттестации показывается отдельно: «Ещё не проходил», «Зачтено», «Не зачтено» либо результат экзамена. Даты аттестаций доступны во вкладке «Сессия» раздела «Успеваемость».\n\n3. Отметка о готовности в личном плане нужна только самому студенту. Она не отправляет работу преподавателю, не изменяет оценки и не подтверждает сдачу задания.\n\n4. Даты пересдач и правила апелляции в демонстрационной базе не установлены. Не следует придумывать сроки или применять учебный образец к реальной аттестации: нужны актуальные официальные сведения.",
  },
  {
    id: "demo-scholarship-policy",
    title: "Положение о стипендии",
    version: "Демо-положение № 05 от 15.11.2026",
    text: "# Положение о стипендии\n\nДемонстрационное положение № 05. Все условия вымышлены и не являются правилами назначения выплат в университете.\n\n1. В учебном примере академическая стипендия рассматривается после аттестации при отсутствии академической задолженности. Сам по себе текущий балл до сессии не подтверждает право на выплату.\n\n2. Размер, решение о назначении и дата выплаты стипендии в этой демобазе не установлены. Поиск не должен выдавать предполагаемую сумму как факт.\n\n3. Справку о стипендии можно заказать в разделе «Заявки и справки», указав цель получения. Демонстрационный срок подготовки — три рабочих дня. Скачиваемый документ имеет отметку «ОБРАЗЕЦ» и не подтверждает настоящие выплаты.",
  },
];

function rejectSecrets(text) {
  if (
    /(?:\borbita_(?:mcp_[a-f0-9]{64}|[a-f0-9]{32})\b|\b\d{6,12}:[a-zA-Z0-9_-]{30,}\b|\bbearer\s+[a-zA-Z0-9_.-]{16,}|\bsk-[a-zA-Z0-9_-]{16,}|\bAIza[a-zA-Z0-9_-]{25,}|\beyJ[a-zA-Z0-9_-]{12,}\.[a-zA-Z0-9_-]{12,}\.[a-zA-Z0-9_-]{12,}|(?:api[_ -]?key|access[_ -]?token|client[_ -]?secret|bot[_ -]?token|token|токен|password|пароль)\s*[:=]\s*["']?[^\s"']{8,})/iu.test(
      text,
    )
  )
    throw fail(
      400,
      "В тексте обнаружен возможный пароль или ключ доступа. Удалите секреты перед загрузкой.",
    );
}

async function extractPdf(bytes) {
  let parser;
  try {
    const { PDFParse } = await import("pdf-parse");
    parser = new PDFParse({ data: new Uint8Array(bytes) });
    const info = await parser.getInfo();
    if (info.total > MAX_PAGES)
      throw fail(
        413,
        `В PDF больше ${MAX_PAGES} страниц. Загрузите меньший документ.`,
      );
    const result = await parser.getText();
    const text =
      result.pages
        ?.map((page) => `# Страница ${page.num}\n\n${page.text}`)
        .join("\n\n") || result.text;
    if (text.length > MAX_TEXT)
      throw fail(
        413,
        "В документе больше 100 000 символов. Разделите его на части.",
      );
    return text;
  } catch (error) {
    if (error.status) throw error;
    throw fail(
      400,
      "Не удалось прочитать PDF. Файл может быть повреждён или защищён паролем. Загрузите обычный PDF с текстовым слоем, TXT или MD.",
    );
  } finally {
    if (parser) await parser.destroy().catch(() => {});
  }
}

// Parsing untrusted PDFs must not block HTTP requests or escape a wall-clock budget.
// Keep the worker entry in this module so deployment needs no generated worker asset.
if (!isMainThread && workerData?.operation === "knowledge.pdf") {
  try {
    parentPort.postMessage({ text: await extractPdf(workerData.bytes) });
  } catch (error) {
    parentPort.postMessage({
      error: { status: error.status || 400, message: error.message },
    });
  }
}

async function readPdf(bytes, options) {
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { operation: "knowledge.pdf", bytes },
    execArgv: [],
    resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 },
  });
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(
            fail(
              408,
              "Не удалось разобрать PDF за отведённое время. Попробуйте меньший файл или TXT.",
            ),
          ),
        options.pdfTimeoutMs ?? 8000,
      );
      worker.once("message", (result) =>
        result.error
          ? reject(fail(result.error.status, result.error.message))
          : resolve(result.text),
      );
      worker.once("error", () =>
        reject(
          fail(
            400,
            "PDF слишком сложный или повреждён. Попробуйте меньший файл или TXT.",
          ),
        ),
      );
      worker.once("exit", (code) => {
        if (code !== 0)
          reject(
            fail(400, "Разбор PDF прерван. Попробуйте меньший файл или TXT."),
          );
      });
    });
  } finally {
    clearTimeout(timer);
    await worker.terminate();
  }
}

export function installKnowledge(app, db, authenticate, options = {}) {
  const parsingAccounts = new Set();
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_documents (
      id TEXT PRIMARY KEY, owner_id TEXT REFERENCES users(id), title TEXT NOT NULL,
      content TEXT NOT NULL, content_hash TEXT NOT NULL, file_name TEXT,
      format TEXT NOT NULL, fictional INTEGER NOT NULL DEFAULT 0,
      version TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS knowledge_owner ON knowledge_documents(owner_id);
    CREATE UNIQUE INDEX IF NOT EXISTS knowledge_owner_hash ON knowledge_documents(owner_id,content_hash);
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL, section TEXT NOT NULL, content TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS knowledge_chunks_document ON knowledge_chunks(document_id,ordinal);
  `);
  const insertDocument = db.prepare(
    "INSERT INTO knowledge_documents (id,owner_id,title,content,content_hash,file_name,format,fictional,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
  );
  const insertChunk = db.prepare(
    "INSERT INTO knowledge_chunks (id,document_id,ordinal,section,content) VALUES (?,?,?,?,?)",
  );
  const hash = (title, text) =>
    createHash("sha256").update(`${title}\n${text}`).digest("hex");
  const writeChunks = (id, text) =>
    chunksFor(text).forEach((chunk, index) =>
      insertChunk.run(
        `${id}:${index + 1}`,
        id,
        index + 1,
        chunk.section,
        chunk.text,
      ),
    );
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const demo of demos) {
      if (
        db.prepare("SELECT id FROM knowledge_documents WHERE id=?").get(demo.id)
      )
        continue;
      insertDocument.run(
        demo.id,
        null,
        demo.title,
        demo.text,
        hash(demo.title, demo.text),
        null,
        "md",
        1,
        demo.version,
        "2026-11-15T09:00:00Z",
        "2026-11-15T09:00:00Z",
      );
      writeChunks(demo.id, demo.text);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  function metadata(row, userId) {
    return {
      id: row.id,
      title: row.title,
      fileName: row.file_name,
      format: row.format,
      fictional: Boolean(row.fictional),
      private: row.owner_id !== null,
      canDelete: row.owner_id === userId,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  function listDocuments(userId) {
    const rows = db
      .prepare(
        "SELECT * FROM knowledge_documents WHERE owner_id IS NULL OR owner_id=? ORDER BY owner_id IS NULL, updated_at DESC, title",
      )
      .all(userId);
    return {
      documents: rows.map((row) => metadata(row, userId)),
      limits: {
        maxDocuments: MAX_DOCUMENTS,
        maxTextCharacters: MAX_TEXT,
        maxPdfBytes: MAX_PDF_BYTES,
        maxPages: MAX_PAGES,
      },
    };
  }
  function getDocument(userId, id) {
    const row = db
      .prepare(
        "SELECT * FROM knowledge_documents WHERE id=? AND (owner_id IS NULL OR owner_id=?)",
      )
      .get(id, userId);
    if (!row) throw fail(404, "Документ недоступен или удалён.");
    const sections = db
      .prepare(
        "SELECT id,section,content FROM knowledge_chunks WHERE document_id=? ORDER BY ordinal",
      )
      .all(row.id)
      .map((chunk) => ({
        chunkId: chunk.id,
        section: chunk.section,
        text: chunk.content,
      }));
    return {
      document: { ...metadata(row, userId), text: row.content, sections },
    };
  }
  async function importDocument(userId, body) {
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some(
        (key) => !["title", "text", "pdfBase64", "fileName"].includes(key),
      )
    )
      throw fail(400, "Передайте только название и содержимое документа.");
    if (
      typeof body.title !== "string" ||
      !body.title.trim() ||
      body.title.trim().length > 160
    )
      throw fail(400, "Название должно содержать от 1 до 160 символов.");
    if (
      body.fileName !== undefined &&
      (typeof body.fileName !== "string" ||
        body.fileName.length > 180 ||
        /[\r\n\0]/.test(body.fileName))
    )
      throw fail(400, "Некорректное имя файла.");
    const hasText = body.text !== undefined;
    const hasPdf = body.pdfBase64 !== undefined;
    if (hasText === hasPdf)
      throw fail(400, "Загрузите один текстовый документ или PDF.");
    let text;
    let format = body.fileName?.toLowerCase().endsWith(".md") ? "md" : "txt";
    if (hasPdf) {
      if (typeof body.pdfBase64 !== "string")
        throw fail(400, "Некорректное содержимое PDF.");
      if (body.pdfBase64.length > Math.ceil(MAX_PDF_BYTES / 3) * 4)
        throw fail(413, "PDF должен быть не больше 2 МБ.");
      if (
        !body.pdfBase64.length ||
        body.pdfBase64.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(body.pdfBase64)
      )
        throw fail(400, "Некорректное содержимое PDF.");
      const bytes = Buffer.from(body.pdfBase64, "base64");
      if (bytes.toString("base64") !== body.pdfBase64)
        throw fail(400, "Некорректное содержимое PDF.");
      if (bytes.length > MAX_PDF_BYTES)
        throw fail(413, "PDF должен быть не больше 2 МБ.");
      if (bytes.subarray(0, 5).toString() !== "%PDF-")
        throw fail(400, "Файл не является PDF.");
      if (parsingAccounts.has(userId) || parsingAccounts.size >= 2)
        throw fail(
          429,
          "Сейчас разбираются другие PDF. Дождитесь окончания загрузки и повторите попытку.",
        );
      parsingAccounts.add(userId);
      try {
        text = await readPdf(bytes, options);
      } finally {
        parsingAccounts.delete(userId);
      }
      format = "pdf";
    } else {
      if (typeof body.text !== "string")
        throw fail(400, "Содержимое TXT или MD должно быть текстом.");
      text = body.text;
    }
    text = normalizeText(text || "");
    // PDF page headings are metadata, not proof of a searchable text layer.
    const searchable = text.replace(/^# Страница \d+$/gm, "").trim();
    if (searchable.length < 20 || !(searchable.match(/\p{L}/gu)?.length >= 10))
      throw fail(
        400,
        hasPdf
          ? "В PDF нет достаточного текстового слоя. Скан нужно сначала распознать, затем загрузить TXT, MD или PDF с текстом."
          : "Добавьте содержательный текст: не менее 20 символов и 10 букв.",
      );
    if (text.length > MAX_TEXT)
      throw fail(
        413,
        "В документе больше 100 000 символов. Разделите его на части.",
      );
    rejectSecrets(`${body.title}\n${body.fileName || ""}\n${text}`);
    const title = body.title.trim();
    const digest = hash(title, text);
    db.exec("BEGIN IMMEDIATE");
    try {
      const existing = db
        .prepare(
          "SELECT id FROM knowledge_documents WHERE owner_id=? AND content_hash=?",
        )
        .get(userId, digest);
      if (existing) {
        db.exec("COMMIT");
        return { ...getDocument(userId, existing.id), duplicate: true };
      }
      const quota = db
        .prepare(
          "SELECT COUNT(*) AS count, COALESCE(SUM(length(content)),0) AS characters FROM knowledge_documents WHERE owner_id=?",
        )
        .get(userId);
      if (
        quota.count >= MAX_DOCUMENTS ||
        quota.characters + text.length > MAX_ACCOUNT_TEXT
      )
        throw fail(
          429,
          "В аккаунте можно хранить до 30 своих документов и 500 000 символов. Удалите ненужный файл перед загрузкой.",
        );
      const id = randomUUID();
      const now = new Date().toISOString();
      insertDocument.run(
        id,
        userId,
        title,
        text,
        digest,
        body.fileName || null,
        format,
        0,
        "Загрузка аккаунта · версия 1",
        now,
        now,
      );
      writeChunks(id, text);
      db.exec("COMMIT");
      return getDocument(userId, id);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  function deleteDocument(userId, id) {
    const { document } = getDocument(userId, id);
    if (!document.canDelete)
      throw fail(403, "Общие демонстрационные документы нельзя удалять.");
    db.prepare("DELETE FROM knowledge_documents WHERE id=? AND owner_id=?").run(
      id,
      userId,
    );
    return { ok: true };
  }
  function search(userId, query, { limit = 5, scope = "accessible" } = {}) {
    if (
      typeof query !== "string" ||
      query.trim().length < 2 ||
      query.length > 500
    )
      throw fail(400, "Введите вопрос длиной от 2 до 500 символов.");
    const queryTerms = [...new Set(terms(query))].slice(0, 24);
    const originalTerms = [...queryTerms];
    if (!originalTerms.length)
      return { query: query.trim(), sources: [], hasResults: false };
    if (
      /\bwhen\b|когда|до какого|сколько.{0,20}(дней|дня|времени)/iu.test(query)
    )
      queryTerms.push("срок");
    // Authorization is part of the SQL query, before any ranking or statistics.
    const rows = db
      .prepare(
        `SELECT c.id AS chunk_id,c.section,c.content AS quote,d.id AS document_id,d.title,d.fictional,d.version,d.updated_at
      FROM knowledge_chunks c JOIN knowledge_documents d ON d.id=c.document_id
      WHERE (d.owner_id IS NULL AND ? != 'private')
        OR (d.owner_id=? AND ? != 'shared')`,
      )
      .all(scope, userId, scope);
    const corpus = rows.map((row) => ({
      row,
      words: terms(row.quote),
      titleWords: terms(row.title),
    }));
    const averageLength =
      corpus.reduce((sum, entry) => sum + entry.words.length, 0) /
      Math.max(1, corpus.length);
    const frequencies = new Map(
      queryTerms.map((term) => [
        term,
        corpus.filter((entry) => entry.words.includes(term) || entry.titleWords.includes(term)).length,
      ]),
    );
    const ranked = corpus
      .map(({ row, words, titleWords }) => {
        let score = 0;
        let matched = 0;
        for (const term of queryTerms) {
          const frequency =
            words.filter((word) => word === term).length +
            (titleWords.includes(term) ? 0.75 : 0);
          if (!frequency) continue;
          matched++;
          const documents = frequencies.get(term);
          const idf = Math.log(
            1 + (corpus.length - documents + 0.5) / (documents + 0.5),
          );
          const weightedFrequency =
            frequency + (titleWords.includes(term) ? 0.25 : 0);
          score +=
            (idf * (weightedFrequency * 2.2)) /
            (weightedFrequency +
              1.2 *
                (0.25 + (0.75 * words.length) / Math.max(1, averageLength)));
        }
        // Keep a weak single-word match from dominating a focused multi-term query.
        score *= 0.5 + matched / queryTerms.length;
        // A temporal hint alone is not evidence for an otherwise unrelated query.
        if (!originalTerms.some((term) => words.includes(term) || titleWords.includes(term))) score = 0;
        score *=
          1 +
          queryTerms.filter((term) => titleWords.includes(term)).length /
            queryTerms.length;
        if (!/^Пункт |^Страница /.test(row.section)) score *= 0.65;
        return {
          documentId: row.document_id,
          chunkId: row.chunk_id,
          title: row.title,
          section: row.section,
          quote: row.quote,
          score: Number(score.toFixed(5)),
          fictional: Boolean(row.fictional),
          version: row.version,
          updatedAt: row.updated_at,
        };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId));
    const take = Math.min(8, Math.max(1, Number.isInteger(limit) ? limit : 5));
    const sources = ranked
      .filter((source) => source.score >= ranked[0].score * 0.18)
      .slice(0, take);
    return { query: query.trim(), sources, hasResults: sources.length > 0 };
  }

  app.get("/api/knowledge/documents", authenticate, (req, res) =>
    res.json(listDocuments(req.user.id)),
  );
  app.post("/api/knowledge/documents", authenticate, async (req, res) => {
    const result = await importDocument(req.user.id, req.body);
    res.status(result.duplicate ? 200 : 201).json(result);
  });
  app.get("/api/knowledge/documents/:id", authenticate, (req, res) =>
    res.json(getDocument(req.user.id, req.params.id)),
  );
  app.delete("/api/knowledge/documents/:id", authenticate, (req, res) =>
    res.json(deleteDocument(req.user.id, req.params.id)),
  );
  app.get("/api/knowledge/search", authenticate, (req, res) =>
    res.json(search(req.user.id, req.query.q)),
  );
  return { listDocuments, getDocument, importDocument, deleteDocument, search };
}
