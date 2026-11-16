import { useEffect, useState } from "react";
import {
  BellRing,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Link2,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Unplug,
  Workflow,
} from "lucide-react";
import api from "../api.js";
import "./connections.css";

const SCOPE_LABELS = {
  "profile:read": "Читать профиль",
  "schedule:read": "Смотреть расписание",
  "bookings:read": "Смотреть свои брони",
  "bookings:write": "Готовить и подтверждать бронирование",
  "housing:read": "Смотреть начисления общежития",
  "requests:write": "Готовить и подтверждать заявки",
  "knowledge:read": "Искать в доступных документах",
};
const EVENT_LABELS = {
  demo: "Демо · сохранено локально",
  pending: "В очереди",
  processing: "Отправляем",
  delivered: "Доставлено провайдером",
  failed: "Не отправлено",
  cancelled: "Отменено",
  uncertain: "Доставка не подтверждена",
};
const ERROR_LABELS = {
  provider_not_configured:
    "Для отправки нужно настроить серверное подключение.",
  rate_limited: "Провайдер ограничил частоту. Запланирована повторная попытка.",
  retry_limit: "Лимит повторов исчерпан. Проверьте настройки подключения.",
  provider_rejected:
    "Провайдер отклонил сообщение. Проверьте доступ бота к диалогу.",
  response_lost:
    "Ответ потерян. Повторная отправка отключена, чтобы не продублировать сообщение.",
  unreadable_response:
    "Ответ не удалось прочитать. Повторная отправка отключена, чтобы не продублировать сообщение.",
  provider_unavailable:
    "Провайдер недоступен. Результат отправки пока неизвестен.",
  interrupted:
    "Отправка была прервана. Автоматически повторять её небезопасно.",
  disconnected: "Канал отключён; ожидавшее сообщение отменено.",
  disconnected_in_flight:
    "Канал отключён во время отправки. Сообщение могло уже уйти; автоматического повтора не будет.",
};
const dateLabel = (value) => {
  if (!value) return "Ещё не использовался";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Дата не указана";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(date);
};

export function Connections({ notify }) {
  const [channels, setChannels] = useState(null);
  const [mcp, setMcp] = useState(null);
  const [channelError, setChannelError] = useState("");
  const [mcpError, setMcpError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [pairing, setPairing] = useState(null);
  const [disconnecting, setDisconnecting] = useState(null);
  const [tokenName, setTokenName] = useState("");
  const [scopes, setScopes] = useState([
    "schedule:read",
    "bookings:read",
    "knowledge:read",
  ]);
  const [freshToken, setFreshToken] = useState(null);
  const [revoking, setRevoking] = useState(null);
  const [copyMessage, setCopyMessage] = useState("");

  useEffect(() => {
    let active = true;
    Promise.allSettled([api("/channels"), api("/mcp/tokens")]).then(
      ([channelResult, tokenResult]) => {
        if (!active) return;
        if (channelResult.status === "fulfilled")
          setChannels(channelResult.value);
        else setChannelError(channelResult.reason.message);
        if (tokenResult.status === "fulfilled") setMcp(tokenResult.value);
        else setMcpError(tokenResult.reason.message);
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  async function reload() {
    setBusy("refresh");
    const [channelResult, tokenResult] = await Promise.allSettled([
      api("/channels"),
      api("/mcp/tokens"),
    ]);
    if (channelResult.status === "fulfilled") {
      setChannels(channelResult.value);
      setChannelError("");
    } else setChannelError(channelResult.reason.message);
    if (tokenResult.status === "fulfilled") {
      setMcp(tokenResult.value);
      setMcpError("");
    } else setMcpError(tokenResult.reason.message);
    setBusy("");
  }
  async function channelAction(provider, action) {
    if (busy) return;
    setBusy(`${provider}:${action}`);
    setChannelError("");
    try {
      const result = await api(
        `/channels/${provider}${action === "disconnect" ? "" : `/${action}`}`,
        { method: action === "disconnect" ? "DELETE" : "POST" },
      );
      if (action === "pair") setPairing(result);
      else {
        setChannels(await api("/channels"));
        setPairing(null);
      }
      setDisconnecting(null);
      if (action === "demo-connect")
        notify?.("Демоканал подключён. Сообщения сохраняются только здесь.");
      if (action === "disconnect")
        notify?.("Канал отключён. Ожидавшие сообщения отменены.");
    } catch (error) {
      setChannelError(error.message);
    } finally {
      setBusy("");
    }
  }
  async function testNotification() {
    if (busy) return;
    setBusy("test");
    setChannelError("");
    try {
      setChannels(await api("/channels/test", { method: "POST" }));
      notify?.(
        "Тестовое событие добавлено в журнал. Статус показывает результат обработки.",
      );
    } catch (error) {
      setChannelError(error.message);
    } finally {
      setBusy("");
    }
  }
  async function createToken(event) {
    event.preventDefault();
    if (busy) return;
    setMcpError("");
    if (!tokenName.trim() || !scopes.length) {
      setMcpError(
        "Укажите название подключения и выберите хотя бы одно разрешение.",
      );
      return;
    }
    setBusy("token-create");
    try {
      const result = await api("/mcp/tokens", {
        method: "POST",
        body: { name: tokenName.trim(), scopes },
      });
      setFreshToken(result);
      setTokenName("");
      setCopyMessage("");
      setMcp(await api("/mcp/tokens"));
      notify?.("Токен создан. Сохраните его в настройках своего MCP-клиента.");
    } catch (error) {
      setMcpError(error.message);
    } finally {
      setBusy("");
    }
  }
  async function revokeToken(id) {
    if (busy) return;
    setBusy(`revoke:${id}`);
    setMcpError("");
    try {
      await api(`/mcp/tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
      setMcp(await api("/mcp/tokens"));
      setRevoking(null);
      if (freshToken?.record?.id === id) setFreshToken(null);
      notify?.("Доступ отозван. Этот токен больше не подходит для MCP.");
    } catch (error) {
      setMcpError(error.message);
    } finally {
      setBusy("");
    }
  }
  async function copy(value, label) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage(`${label} скопирован.`);
    } catch {
      setCopyMessage(
        "Копирование недоступно. Выделите текст и скопируйте его вручную.",
      );
    }
  }
  const endpoint =
    mcp?.endpoint || freshToken?.endpoint || "http://localhost:3001/mcp";
  const availableScopes = mcp?.availableScopes || [];
  const remoteConfig = JSON.stringify(
    {
      mcpServers: {
        orbita: {
          type: "http",
          url: endpoint,
          headers: { Authorization: "Bearer <ВАШ_ТОКЕН>" },
        },
      },
    },
    null,
    2,
  );
  const stdioConfig = JSON.stringify(
    {
      mcpServers: {
        orbita: {
          command: "node",
          args: ["/путь/к/проекту/scripts/mcp-stdio.mjs"],
          env: { ORBITA_MCP_URL: endpoint, ORBITA_MCP_TOKEN: "<ВАШ_ТОКЕН>" },
        },
      },
    },
    null,
    2,
  );

  return (
    <div className="connections-page">
      <header className="connections-heading">
        <div>
          <span className="connections-eyebrow">
            Кабинет там, где удобно вам
          </span>
          <h1>Подключения</h1>
          <p>Уведомления в мессенджерах и доступ из вашей нейросети.</p>
        </div>
        <button
          className="button secondary"
          disabled={!!busy || loading}
          onClick={reload}
        >
          <RefreshCw size={17} aria-hidden="true" />
          Обновить статус
        </button>
      </header>
      <div className="connections-honesty">
        <ShieldCheck size={21} aria-hidden="true" />
        <p>
          <strong>Общий учебный демоаккаунт.</strong> Другие посетители того же
          аккаунта видят его подключения и могут отзывать токены. Используйте
          только демонстрационные данные. Токен не открывает данные другого
          студента.
        </p>
      </div>
      {loading ? (
        <div className="card connections-loading" role="status">
          <LoaderCircle
            className="connections-spin"
            size={24}
            aria-hidden="true"
          />
          <p>Загружаем подключения…</p>
        </div>
      ) : (
        <>
          <section aria-labelledby="connections-channels-title">
            <div className="connections-section-heading">
              <span className="connections-icon">
                <BellRing size={22} aria-hidden="true" />
              </span>
              <div>
                <h2 id="connections-channels-title">Не пропускать изменения</h2>
                <p>
                  Заявки, бронирования и учебные события — в выбранном канале.
                </p>
              </div>
            </div>
            {channelError && (
              <p className="connections-error" role="alert">
                {channelError}
              </p>
            )}
            {!channels && (
              <button
                className="button secondary"
                onClick={reload}
                disabled={!!busy}
              >
                Повторить загрузку каналов
              </button>
            )}
            {channels && (
              <>
                {!channels.realLinkingAllowed && (
                  <p className="connections-note">
                    Настоящие привязки отключены на этом сервере.
                    Демоподключение показывает полный путь события в локальном
                    журнале и ничего не отправляет в Telegram или VK.
                  </p>
                )}
                <div className="connections-channel-grid">
                  {channels.channels.map((channel) => (
                    <article
                      className="card connections-channel"
                      key={channel.provider}
                    >
                      <div className="connections-channel-title">
                        <span
                          className={`connections-channel-symbol connections-${channel.provider}`}
                          aria-hidden="true"
                        >
                          {channel.provider === "telegram" ? "ТГ" : "VK"}
                        </span>
                        <div>
                          <h3>{channel.title}</h3>
                          <span
                            className={`connections-status ${channel.connection ? "is-connected" : ""}`}
                          >
                            {channel.connection?.mode === "demo"
                              ? "Демоканал подключён"
                              : channel.connection?.mode === "live"
                                ? "Личный диалог подключён"
                                : "Не подключён"}
                          </span>
                        </div>
                      </div>
                      <p>
                        {channel.connection?.mode === "demo"
                          ? "События сохраняются только в журнале ниже. Реальные сообщения не отправляются."
                          : channel.connection
                            ? `${channel.connection.recipientLabel}. Подключён ${dateLabel(channel.connection.connectedAt)} МСК.`
                            : "Получайте события своего аккаунта. Вы сами выбираете, когда подключить или отключить канал."}
                      </p>
                      <p className="connections-configuration">
                        {channel.configured
                          ? "Подключение к сервису настроено"
                          : "Для настоящих сообщений администратору нужно настроить подключение"}
                      </p>
                      {channel.connection ? (
                        <>
                          {disconnecting === channel.provider ? (
                            <div className="connections-confirm">
                              <p>
                                Отключить {channel.title}? Сообщения в очереди
                                будут отменены, журнал сохранится.
                              </p>
                              <div>
                                <button
                                  className="button secondary"
                                  disabled={!!busy}
                                  onClick={() =>
                                    channelAction(
                                      channel.provider,
                                      "disconnect",
                                    )
                                  }
                                >
                                  Подтвердить отключение
                                </button>
                                <button
                                  className="button secondary"
                                  disabled={!!busy}
                                  onClick={() => setDisconnecting(null)}
                                >
                                  Отмена
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              className="button secondary"
                              disabled={!!busy}
                              onClick={() => setDisconnecting(channel.provider)}
                            >
                              <Unplug size={16} aria-hidden="true" />
                              Отключить {channel.title}
                            </button>
                          )}
                        </>
                      ) : (
                        <div className="connections-actions">
                          <button
                            className="button"
                            disabled={!!busy}
                            onClick={() =>
                              channelAction(channel.provider, "demo-connect")
                            }
                          >
                            Подключить демо {channel.title}
                          </button>
                          {channel.liveAllowed && (
                            <button
                              className="button secondary"
                              disabled={!!busy}
                              onClick={() =>
                                channelAction(channel.provider, "pair")
                              }
                            >
                              <Link2 size={16} aria-hidden="true" />
                              Подключить {channel.title}
                            </button>
                          )}
                        </div>
                      )}
                      {pairing?.provider === channel.provider && (
                        <div className="connections-pairing" role="status">
                          <strong>Подтвердите личный диалог</strong>
                          <p>{pairing.instructions}</p>
                          <label
                            htmlFor={`channel-pair-code-${channel.provider}`}
                          >
                            Одноразовый код
                          </label>
                          <input
                            id={`channel-pair-code-${channel.provider}`}
                            readOnly
                            value={pairing.code}
                            onFocus={(event) => event.target.select()}
                          />
                          <p>
                            Действует до {dateLabel(pairing.expiresAt)} МСК.
                            Выход из кабинета отменяет возможность привязки.
                          </p>
                          <a
                            className="button secondary"
                            href={pairing.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Открыть {channel.title}
                            <ExternalLink size={15} aria-hidden="true" />
                          </a>
                          <button
                            className="connections-text-button"
                            onClick={() => copy(pairing.code, "Код")}
                          >
                            Скопировать код
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
                <div className="card connections-journal">
                  <div className="connections-journal-heading">
                    <div>
                      <h3>Журнал событий</h3>
                      <p>
                        Последние 50 событий вашего аккаунта. Статус «Демо» не
                        означает доставку в мессенджер.
                      </p>
                    </div>
                    <button
                      className="button secondary"
                      disabled={
                        !!busy ||
                        !channels.channels.some((channel) => channel.connection)
                      }
                      onClick={testNotification}
                    >
                      <BellRing size={16} aria-hidden="true" />
                      Тест уведомления
                    </button>
                  </div>
                  {channels.events.length ? (
                    <ol>
                      {channels.events.map((event) => (
                        <li key={event.id}>
                          <div className="connections-event-head">
                            <span>
                              {TITLES[event.provider] || event.provider}
                            </span>
                            <time
                              dateTime={new Date(event.createdAt).toISOString()}
                            >
                              {dateLabel(event.createdAt)} МСК
                            </time>
                          </div>
                          <strong>{event.title}</strong>
                          <p>{event.body}</p>
                          <span
                            className={`connections-event-status connections-event-${event.status}`}
                          >
                            {EVENT_LABELS[event.status] || event.status}
                          </span>
                          {event.errorCode && (
                            <p className="connections-event-detail">
                              {ERROR_LABELS[event.errorCode] ||
                                "Проверьте состояние подключения."}
                            </p>
                          )}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <div className="connections-empty">
                      <BellRing size={26} aria-hidden="true" />
                      <strong>Пока нет событий</strong>
                      <p>
                        Подключите демоканал и нажмите «Тест уведомления», либо
                        создайте заявку или бронь.
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
          <section
            className="connections-mcp"
            aria-labelledby="connections-mcp-title"
          >
            <div className="connections-section-heading">
              <span className="connections-icon">
                <Workflow size={23} aria-hidden="true" />
              </span>
              <div>
                <h2 id="connections-mcp-title">Курсом в вашей нейросети</h2>
                <p>
                  MCP даёт вашему помощнику доступ к расписанию, документам и
                  действиям с подтверждением.
                </p>
              </div>
            </div>
            {mcpError && (
              <p className="connections-error" role="alert">
                {mcpError}
              </p>
            )}
            {!mcp && (
              <button
                className="button secondary"
                onClick={reload}
                disabled={!!busy}
              >
                Повторить загрузку MCP
              </button>
            )}
            {mcp && (
              <div className="connections-mcp-grid">
                <div className="card connections-token-form">
                  <h3>
                    <KeyRound size={20} aria-hidden="true" />
                    Создать доступ
                  </h3>
                  <p>
                    Токен действует 7 дней. Выберите только нужные разрешения;
                    отозвать его можно в любое время.
                  </p>
                  <form onSubmit={createToken}>
                    <label className="connections-field">
                      Название подключения
                      <input
                        value={tokenName}
                        onChange={(event) => setTokenName(event.target.value)}
                        placeholder="Например, мой помощник на ноутбуке"
                        required
                        maxLength={60}
                        disabled={!!busy}
                      />
                    </label>
                    <fieldset className="connections-scopes">
                      <legend>Разрешения</legend>
                      {availableScopes.map((scope) => (
                        <label key={scope}>
                          <input
                            type="checkbox"
                            checked={scopes.includes(scope)}
                            onChange={(event) =>
                              setScopes((current) =>
                                event.target.checked
                                  ? [...current, scope]
                                  : current.filter((value) => value !== scope),
                              )
                            }
                            disabled={!!busy}
                          />
                          <span>
                            {SCOPE_LABELS[scope] || scope}
                            {scope.endsWith(":write") && (
                              <small>
                                Изменения требуют отдельного подтверждения
                              </small>
                            )}
                          </span>
                        </label>
                      ))}
                    </fieldset>
                    <button
                      className="button"
                      disabled={!!busy || !scopes.length}
                    >
                      <KeyRound size={17} aria-hidden="true" />
                      Создать MCP-токен
                    </button>
                  </form>
                  {freshToken && (
                    <div className="connections-secret" role="status">
                      <strong>Скопируйте токен сейчас</strong>
                      <p>
                        Он показан только в этом сеансе страницы. После закрытия
                        его можно только отозвать и создать новый. Не публикуйте
                        токен и не отправляйте его в чаты.
                      </p>
                      <label htmlFor="connections-new-mcp-token">
                        Новый MCP-токен
                      </label>
                      <textarea
                        id="connections-new-mcp-token"
                        readOnly
                        value={freshToken.token}
                        rows={3}
                        onFocus={(event) => event.target.select()}
                      />
                      <div className="connections-actions">
                        <button
                          className="button secondary"
                          onClick={() => copy(freshToken.token, "Токен")}
                        >
                          <Copy size={16} aria-hidden="true" />
                          Скопировать токен
                        </button>
                        <button
                          className="connections-text-button"
                          onClick={() => setFreshToken(null)}
                        >
                          Скрыть токен
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="card connections-token-list">
                  <h3>Выданные доступы</h3>
                  <p>
                    Отзыв немедленно блокирует дальнейшие запросы с этим
                    токеном.
                  </p>
                  {mcp.tokens.length ? (
                    <ul>
                      {mcp.tokens.map((token) => (
                        <li key={token.id}>
                          <strong>{token.name}</strong>
                          <p>До {dateLabel(token.expiresAt)} МСК</p>
                          <p>
                            Последнее использование:{" "}
                            {dateLabel(token.lastUsedAt)}
                            {token.lastUsedAt ? " МСК" : ""}
                          </p>
                          <div className="connections-scope-tags">
                            {token.scopes.map((scope) => (
                              <span key={scope}>
                                {SCOPE_LABELS[scope] || scope}
                              </span>
                            ))}
                          </div>
                          {revoking === token.id ? (
                            <div className="connections-confirm">
                              <p>
                                Отозвать доступ «{token.name}»? Подключённый
                                помощник больше не сможет его использовать.
                              </p>
                              <div>
                                <button
                                  className="button secondary"
                                  disabled={!!busy}
                                  onClick={() => revokeToken(token.id)}
                                >
                                  Подтвердить отзыв
                                </button>
                                <button
                                  className="button secondary"
                                  disabled={!!busy}
                                  onClick={() => setRevoking(null)}
                                >
                                  Отмена
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              className="connections-text-button"
                              disabled={!!busy}
                              onClick={() => setRevoking(token.id)}
                            >
                              Отозвать «{token.name}»
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="connections-empty">
                      <KeyRound size={26} aria-hidden="true" />
                      <strong>Пока нет токенов</strong>
                      <p>
                        Создайте доступ только для своего доверенного
                        MCP-клиента.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
            {mcp && (
              <details className="card connections-guide">
                <summary>Как подключить MCP-клиент</summary>
                <p>
                  Адрес сервера: <code>{endpoint}</code>. Используется
                  Streamable HTTP и заголовок{" "}
                  <code>Authorization: Bearer …</code>. Автоматический вход
                  через OAuth не заявляется; клиент должен поддерживать
                  собственный заголовок авторизации.
                </p>
                <p>
                  Пример для клиента с HTTP-подключениями. Вставьте токен только
                  в его защищённые настройки; точный формат зависит от клиента.
                </p>
                <pre>{remoteConfig}</pre>
                <p>
                  Если клиент поддерживает только stdio, запустите мост из
                  проекта. Нужен Node.js 24; замените путь к файлу на свой.
                </p>
                <pre>{stdioConfig}</pre>
                <p>
                  Локальный адрес доступен только с вашего компьютера. Для
                  облачного помощника понадобится доступный ему HTTPS-адрес
                  сервера. Создание токена само по себе не подключает внешний
                  сервис.
                </p>
              </details>
            )}
          </section>
        </>
      )}
      {copyMessage && (
        <p className="connections-copy-message" role="status">
          <Check size={16} aria-hidden="true" />
          {copyMessage}
        </p>
      )}
    </div>
  );
}

const TITLES = { telegram: "Telegram", vk: "VK" };
