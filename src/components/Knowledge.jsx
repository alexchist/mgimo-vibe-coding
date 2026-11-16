import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  FileText,
  Info,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import api from "../api";
import "./knowledge.css";

const examples = [
  "Как отменить бронь комнаты?",
  "Когда оплачивать общежитие?",
  "За сколько дней готовят справку?",
];
const dateLabel = (date) => new Date(date).toLocaleDateString("ru-RU");
function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () =>
      reject(new Error("Не удалось прочитать файл. Выберите его ещё раз."));
    reader.readAsDataURL(file);
  });
}

export function Knowledge({ notify, focusId }) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadStatus, setUploadStatus] = useState("");
  const [selectedId, setSelectedId] = useState(focusId || null);
  const [selectedChunk, setSelectedChunk] = useState(null);
  const [document, setDocument] = useState(null);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [documentError, setDocumentError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const fileInput = useRef(null);
  const documentHeading = useRef(null);
  const uploadLock = useRef(false);

  async function loadDocuments() {
    setLoading(true);
    setListError("");
    try {
      setDocuments((await api("/knowledge/documents")).documents);
    } catch (error) {
      setListError(error.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    loadDocuments();
  }, []);
  useEffect(() => {
    if (focusId) {
      setSelectedId(focusId);
      setSelectedChunk(null);
    }
  }, [focusId]);
  useEffect(() => {
    if (!selectedId) {
      setDocument(null);
      return;
    }
    const controller = new AbortController();
    setDocumentLoading(true);
    setDocumentError("");
    setDocument(null);
    api(`/knowledge/documents/${encodeURIComponent(selectedId)}`, {
      signal: controller.signal,
    })
      .then((result) => setDocument(result.document))
      .catch((error) => {
        if (error.name !== "AbortError") setDocumentError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDocumentLoading(false);
      });
    return () => controller.abort();
  }, [selectedId]);
  useEffect(() => {
    if (document) documentHeading.current?.focus({ preventScroll: false });
  }, [document]);

  async function search(value) {
    const question = value.trim();
    if (!question || searching) return;
    setQuery(value);
    setSearching(true);
    setSearchError("");
    try {
      setResults(
        await api(`/knowledge/search?q=${encodeURIComponent(question)}`),
      );
    } catch (error) {
      setSearchError(error.message);
    } finally {
      setSearching(false);
    }
  }
  function chooseFile(event) {
    const chosen = event.target.files?.[0];
    setUploadError("");
    setUploadStatus("");
    if (!chosen) return;
    if (!/\.(txt|md|pdf)$/i.test(chosen.name)) {
      setUploadError("Выберите TXT, MD или PDF с текстовым слоем.");
      event.target.value = "";
      return;
    }
    if (chosen.size > 2 * 1024 * 1024) {
      setUploadError("Файл должен быть не больше 2 МБ.");
      event.target.value = "";
      return;
    }
    setFile(chosen);
    if (!title) setTitle(chosen.name.replace(/\.[^.]+$/, "").slice(0, 160));
  }
  function clearFile() {
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
  }
  async function upload(event) {
    event.preventDefault();
    if (uploadLock.current) return;
    uploadLock.current = true;
    setUploading(true);
    setUploadError("");
    setUploadStatus("");
    try {
      const body = { title };
      if (file) {
        body.fileName = file.name;
        if (/\.pdf$/i.test(file.name))
          body.pdfBase64 = await fileAsBase64(file);
        else body.text = await file.text();
      } else body.text = text;
      const result = await api("/knowledge/documents", {
        method: "POST",
        body,
      });
      setDocuments((current) => [
        result.document,
        ...current.filter((item) => item.id !== result.document.id),
      ]);
      setTitle("");
      setText("");
      clearFile();
      setSelectedId(result.document.id);
      setSelectedChunk(null);
      const message = result.duplicate
        ? "Этот документ уже есть в аккаунте. Открыта сохранённая версия."
        : "Документ добавлен. Теперь его текст доступен в поиске.";
      setUploadStatus(message);
      notify?.(
        result.duplicate
          ? "Документ уже загружен"
          : "Документ добавлен в поиск",
      );
    } catch (error) {
      setUploadError(error.message);
    } finally {
      uploadLock.current = false;
      setUploading(false);
    }
  }
  async function removeDocument() {
    if (!confirmDelete || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await api(
        `/knowledge/documents/${encodeURIComponent(confirmDelete.id)}`,
        { method: "DELETE" },
      );
      setDocuments((current) =>
        current.filter((item) => item.id !== confirmDelete.id),
      );
      if (selectedId === confirmDelete.id) setSelectedId(null);
      if (results) setResults(null);
      setConfirmDelete(null);
      notify?.("Документ и его фрагменты удалены");
    } catch (error) {
      setDeleteError(error.message);
    } finally {
      setDeleting(false);
    }
  }
  function openDocument(id, chunkId = null) {
    setSelectedChunk(chunkId);
    if (selectedId === id) documentHeading.current?.focus();
    else setSelectedId(id);
  }

  return (
    <div className="knowledge-page">
      <header className="knowledge-heading">
        <div>
          <p className="knowledge-eyebrow">Информация с источниками</p>
          <h1>База знаний</h1>
          <p>Правила, приказы и ответы, которые можно проверить.</p>
        </div>
        <span className="knowledge-mode">
          <BookOpen size={16} aria-hidden="true" /> Поиск по документам
        </span>
      </header>
      <div className="knowledge-notice">
        <Info size={18} aria-hidden="true" />
        <p>
          <strong>Учебная база, не официальные правила.</strong> Общие документы
          вымышлены. Поиск показывает точные фрагменты и их источники. Генерация
          ответов появится в помощнике после подключения ИИ.
        </p>
      </div>
      <section
        className="knowledge-search knowledge-panel"
        aria-labelledby="knowledge-search-title"
      >
        <h2 id="knowledge-search-title">Что хотите узнать?</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            search(query);
          }}
        >
          <label htmlFor="knowledge-query">Вопрос или ключевые слова</label>
          <div className="knowledge-search-row">
            <input
              id="knowledge-query"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              minLength={2}
              maxLength={500}
              required
              placeholder="Например, когда оплачивать общежитие"
            />
            <button
              className="knowledge-primary"
              type="submit"
              disabled={searching}
            >
              <Search size={17} aria-hidden="true" />
              {searching ? "Ищем…" : "Найти"}
            </button>
          </div>
        </form>
        <div className="knowledge-examples">
          {examples.map((example) => (
            <button
              type="button"
              key={example}
              disabled={searching}
              onClick={() => search(example)}
            >
              {example}
            </button>
          ))}
        </div>
        {searchError && (
          <p role="alert" className="knowledge-error">
            {searchError}
          </p>
        )}
        <div aria-live="polite" aria-busy={searching}>
          {results && (
            <div className="knowledge-results">
              <p className="knowledge-results-label">
                {results.hasResults
                  ? `Источники по запросу «${results.query}» · ${results.sources.length}`
                  : `По запросу «${results.query}» подтверждений нет`}
              </p>
              {results.hasResults && (
                <p className="knowledge-hint">
                  Поиск по словам: фрагмент может содержать только часть
                  запроса. Сверяйте цитату и название источника.
                </p>
              )}
              {!results.hasResults && (
                <p className="knowledge-empty">
                  В доступных документах не найдено подходящих фрагментов.
                  Попробуйте другие слова или добавьте документ. Без источника
                  мы не придумываем ответ.
                </p>
              )}
              {results.sources.map((source, index) => (
                <article className="knowledge-source" key={source.chunkId}>
                  <div className="knowledge-source-top">
                    <span className="knowledge-source-number">{index + 1}</span>
                    <div>
                      <h3>{source.title}</h3>
                      <p>
                        {source.section} · {source.version}
                      </p>
                    </div>
                  </div>
                  <blockquote>{source.quote}</blockquote>
                  <div className="knowledge-source-footer">
                    <span>
                      {source.fictional
                        ? "Вымышленный демо-документ"
                        : "Загрузка этого аккаунта"}
                    </span>
                    <button
                      type="button"
                      className="knowledge-link"
                      onClick={() =>
                        openDocument(source.documentId, source.chunkId)
                      }
                    >
                      Открыть источник{" "}
                      <span className="sr-only">
                        {source.title}, {source.section}
                      </span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
      <div className="knowledge-layout">
        <section
          className="knowledge-panel"
          aria-labelledby="knowledge-library-title"
        >
          <div className="knowledge-section-heading">
            <div>
              <p className="knowledge-eyebrow">Общие и загруженные</p>
              <h2 id="knowledge-library-title">
                Документы <span>{documents.length}</span>
              </h2>
            </div>
            <FileText size={22} aria-hidden="true" />
          </div>
          {loading && (
            <p role="status" className="knowledge-empty">
              Загружаем список документов…
            </p>
          )}
          {listError && (
            <div role="alert" className="knowledge-error">
              <p>{listError}</p>
              <button type="button" onClick={loadDocuments}>
                Повторить загрузку
              </button>
            </div>
          )}
          {!loading && !listError && !documents.length && (
            <p className="knowledge-empty">
              Документов пока нет. Добавьте первый текст для поиска.
            </p>
          )}
          <ul className="knowledge-documents">
            {documents.map((item) => (
              <li
                key={item.id}
                className={selectedId === item.id ? "is-selected" : ""}
              >
                <button
                  type="button"
                  className="knowledge-document-open"
                  onClick={() => openDocument(item.id)}
                  aria-pressed={selectedId === item.id}
                >
                  <span className="knowledge-document-format">
                    {item.format.toUpperCase()}
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {item.fictional
                        ? "Вымышленный демо-документ"
                        : "Файл этого демоаккаунта"}{" "}
                      · {dateLabel(item.updatedAt)}
                    </small>
                  </span>
                </button>
                {item.canDelete && (
                  <button
                    type="button"
                    className="knowledge-delete"
                    aria-label={`Удалить документ «${item.title}»`}
                    onClick={() => {
                      setConfirmDelete(item);
                      setDeleteError("");
                    }}
                  >
                    <Trash2 size={17} aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {confirmDelete && (
            <div
              className="knowledge-delete-confirm"
              role="group"
              aria-label="Подтверждение удаления документа"
            >
              <p>Удалить «{confirmDelete.title}» и его фрагменты из поиска?</p>
              <div>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={removeDocument}
                >
                  {deleting ? "Удаляем…" : "Да, удалить документ"}
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setConfirmDelete(null)}
                >
                  Оставить
                </button>
              </div>
              {deleteError && (
                <p role="alert" className="knowledge-error">
                  {deleteError}
                </p>
              )}
            </div>
          )}
        </section>
        <section
          className="knowledge-panel knowledge-upload"
          aria-labelledby="knowledge-upload-title"
        >
          <div className="knowledge-section-heading">
            <div>
              <p className="knowledge-eyebrow">Пополнить базу</p>
              <h2 id="knowledge-upload-title">Добавить документ</h2>
            </div>
            <Upload size={22} aria-hidden="true" />
          </div>
          <p className="knowledge-upload-warning">
            В демо загружайте только учебные или вымышленные документы. Файлы
            видны всем, кто использует этот демоаккаунт. Не добавляйте закрытые
            сведения, реальные персональные данные, пароли и ключи.
          </p>
          <form onSubmit={upload}>
            <label htmlFor="knowledge-upload-title-input">
              Название документа
            </label>
            <input
              id="knowledge-upload-title-input"
              required
              maxLength={160}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={uploading}
              placeholder="Например, правила учебного клуба"
            />
            <label htmlFor="knowledge-upload-file">Файл TXT, MD или PDF</label>
            <input
              ref={fileInput}
              id="knowledge-upload-file"
              type="file"
              accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
              onChange={chooseFile}
              disabled={uploading}
              aria-describedby="knowledge-file-help"
            />
            <p id="knowledge-file-help" className="knowledge-help">
              До 2 МБ; PDF до 80 страниц, только с текстовым слоем. До 100 000
              символов в документе, до 30 файлов в аккаунте.
            </p>
            {file ? (
              <div className="knowledge-picked-file">
                <span>{file.name}</span>
                <button
                  type="button"
                  disabled={uploading}
                  onClick={clearFile}
                  aria-label="Убрать выбранный файл"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            ) : (
              <>
                <label htmlFor="knowledge-upload-text">
                  Или вставьте текст
                </label>
                <textarea
                  id="knowledge-upload-text"
                  rows={5}
                  minLength={20}
                  maxLength={100000}
                  required
                  disabled={uploading}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder="Скопируйте пункты документа вместе с заголовками. Минимум 20 символов."
                />
              </>
            )}
            {uploadError && (
              <p role="alert" className="knowledge-error">
                {uploadError}
              </p>
            )}
            {uploadStatus && (
              <p role="status" className="knowledge-success">
                {uploadStatus}
              </p>
            )}
            <button
              className="knowledge-primary knowledge-upload-submit"
              type="submit"
              disabled={uploading}
            >
              <Upload size={17} aria-hidden="true" />
              {uploading ? "Разбираем документ…" : "Добавить в базу"}
            </button>
          </form>
        </section>
      </div>
      {selectedId && (
        <section
          className="knowledge-panel knowledge-reader"
          aria-labelledby="knowledge-reader-title"
          aria-busy={documentLoading}
        >
          <div className="knowledge-section-heading">
            <h2 id="knowledge-reader-title" tabIndex={-1} ref={documentHeading}>
              {document?.title || "Источник"}
            </h2>
            <button
              type="button"
              className="knowledge-delete"
              aria-label="Закрыть документ"
              onClick={() => setSelectedId(null)}
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
          {documentLoading && <p role="status">Загружаем текст…</p>}
          {documentError && (
            <p role="alert" className="knowledge-error">
              {documentError}
            </p>
          )}
          {document && (
            <>
              <p className="knowledge-reader-meta">
                {document.version} · Обновлён {dateLabel(document.updatedAt)} ·{" "}
                {document.fictional
                  ? "Все сведения вымышлены"
                  : "Доступен этому аккаунту"}
              </p>
              <div className="knowledge-reader-sections">
                {document.sections.map((section) => (
                  <section
                    key={section.chunkId}
                    className={
                      selectedChunk === section.chunkId ? "is-highlighted" : ""
                    }
                  >
                    <h3>{section.section}</h3>
                    <p>{section.text}</p>
                  </section>
                ))}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
