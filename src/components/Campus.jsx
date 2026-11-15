import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  Home,
  Info,
  MapPin,
  RefreshCw,
  Users,
  X,
} from "lucide-react";
import api from "../api";
import "./campus.css";

const FIRST_DATE = "2026-11-16";
const LAST_DATE = "2026-11-22";
const dateLabel = (value) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
const periodLabel = (value) =>
  new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}-01T12:00:00Z`));
const money = (value) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
  }).format(value / 100);
const asMinutes = (value) => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};
const timeLabel = (value) =>
  `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
const retryKey = (ref, body) => {
  const fingerprint = JSON.stringify(body);
  if (!ref.current || ref.current.fingerprint !== fingerprint)
    ref.current = { fingerprint, key: crypto.randomUUID() };
  return ref.current.key;
};

function ErrorNotice({ children, retry }) {
  return (
    <div className="campus-error" role="alert">
      <span>{children}</span>
      {retry && (
        <button type="button" className="button secondary" onClick={retry}>
          <RefreshCw size={15} /> Повторить загрузку
        </button>
      )}
    </div>
  );
}
function DemoNotice({ children }) {
  return (
    <div className="campus-notice">
      <Info size={18} />
      <p>{children}</p>
    </div>
  );
}

export function Campus({ notify, focusId, refresh }) {
  const [rooms, setRooms] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [roomId, setRoomId] = useState("");
  const [date, setDate] = useState(FIRST_DATE);
  const [duration, setDuration] = useState(60);
  const [start, setStart] = useState("");
  const [purpose, setPurpose] = useState("");
  const [availability, setAvailability] = useState(null);
  const [loading, setLoading] = useState(true);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [slotsError, setSlotsError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(null);
  const [filter, setFilter] = useState("active");
  const [confirmCancel, setConfirmCancel] = useState(null);
  const [reloadSlots, setReloadSlots] = useState(0);
  const [reloadPage, setReloadPage] = useState(0);
  const submitting = useRef(false);
  const idempotency = useRef(null);
  const lastFocus = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    Promise.all([
      api("/campus/rooms", { signal: controller.signal }),
      api("/campus/bookings", { signal: controller.signal }),
    ])
      .then(([roomData, bookingData]) => {
        setRooms(roomData.rooms);
        setBookings(bookingData.bookings);
        setRoomId((current) => current || roomData.rooms[0]?.id || "");
      })
      .catch((error) => {
        if (error.name !== "AbortError") setLoadError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reloadPage]);
  useEffect(() => {
    if (!roomId) return;
    const controller = new AbortController();
    setAvailability(null);
    setSlotsError("");
    setSlotsLoading(true);
    setStart("");
    api(
      `/campus/availability?roomId=${encodeURIComponent(roomId)}&date=${encodeURIComponent(date)}`,
      { signal: controller.signal },
    )
      .then(setAvailability)
      .catch((error) => {
        if (error.name !== "AbortError") setSlotsError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSlotsLoading(false);
      });
    return () => controller.abort();
  }, [roomId, date, reloadSlots]);
  useEffect(() => {
    if (focusId) setFilter("all");
  }, [focusId]);
  useEffect(() => {
    if (
      !focusId ||
      lastFocus.current === focusId ||
      !bookings.some((item) => item.id === focusId)
    )
      return;
    const node = document.getElementById(`campus-booking-${focusId}`);
    if (node) {
      lastFocus.current = focusId;
      node.focus({ preventScroll: true });
      node.scrollIntoView({ block: "center" });
    }
  }, [bookings, filter, focusId]);

  const room = rooms.find((item) => item.id === roomId);
  const slots =
    availability?.room?.id === roomId && availability.date === date
      ? availability.slots
      : [];
  const canStart = (slot) => {
    const from = asMinutes(slot.start);
    const to = from + duration;
    const included = slots.filter(
      (item) => asMinutes(item.start) >= from && asMinutes(item.start) < to,
    );
    return (
      to <= 1260 &&
      included.length === duration / 30 &&
      included.every((item) => item.available)
    );
  };
  const validStart = slots.find(
    (slot) => slot.start === start && canStart(slot),
  );
  const end = start ? timeLabel(asMinutes(start) + duration) : "";
  const active = bookings.filter((item) => item.status === "confirmed");
  const visible = bookings.filter(
    (item) => filter === "all" || item.status === "confirmed",
  );

  async function submit(event) {
    event.preventDefault();
    if (submitting.current || !validStart) return;
    submitting.current = true;
    setBusy("booking");
    setActionError("");
    const body = { roomId, date, start, end, purpose: purpose.trim() };
    try {
      const result = await api("/campus/bookings", {
        method: "POST",
        body,
        headers: { "Idempotency-Key": retryKey(idempotency, body) },
      });
      if (!result.booking?.id)
        throw new Error(
          "Ответ сервера неполный. Повторите бронирование: идентификатор отправки сохранён.",
        );
      setBookings((current) =>
        [
          ...current.filter((item) => item.id !== result.booking.id),
          result.booking,
        ].sort((a, b) =>
          `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`),
        ),
      );
      idempotency.current = null;
      setPurpose("");
      setStart("");
      setFilter("active");
      setReloadSlots((value) => value + 1);
      notify?.("Помещение забронировано в демонстрации");
      Promise.resolve(refresh?.()).catch(() => {});
    } catch (error) {
      setActionError(error.message);
      if (error.status === 409) setReloadSlots((value) => value + 1);
    } finally {
      submitting.current = false;
      setBusy(null);
    }
  }
  async function cancel(id) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(id);
    setActionError("");
    try {
      const result = await api(
        `/campus/bookings/${encodeURIComponent(id)}/cancel`,
        { method: "POST" },
      );
      if (!result.booking?.id)
        throw new Error(
          "Не удалось прочитать результат отмены. Повторите действие.",
        );
      setBookings((current) =>
        current.map((item) => (item.id === id ? result.booking : item)),
      );
      setConfirmCancel(null);
      setReloadSlots((value) => value + 1);
      notify?.("Бронь отменена, время снова свободно");
      Promise.resolve(refresh?.()).catch(() => {});
    } catch (error) {
      setActionError(error.message);
    } finally {
      submitting.current = false;
      setBusy(null);
    }
  }

  return (
    <section className="campus-page">
      <header className="campus-heading">
        <div>
          <p className="campus-eyebrow">Пространство для твоих идей</p>
          <h1>Кампус</h1>
          <p>Собраться командой, подготовить проект, найти тихое место.</p>
        </div>
        <span className="campus-week">
          <CalendarDays size={16} /> 16–22 ноября 2026
        </span>
      </header>
      <DemoNotice>
        <strong>Демонстрационный кампус.</strong> Помещения вымышлены, брони
        сохраняются только в этом прототипе. Время московское: 09:00–21:00, до 2
        часов за раз и до 3 броней в день.
      </DemoNotice>
      {loadError && (
        <ErrorNotice retry={() => setReloadPage((value) => value + 1)}>
          {loadError}
        </ErrorNotice>
      )}
      {loading ? (
        <p className="campus-loading" role="status">
          Загружаем помещения и ваши бронирования…
        </p>
      ) : (
        !loadError && (
          <>
            <div className="campus-layout">
              <div className="campus-spaces">
                <h2>Выбери пространство</h2>
                <p className="campus-muted">
                  {rooms.length} помещения · бесплатно в демоверсии
                </p>
                <div className="campus-room-list">
                  {rooms.map((item) => (
                    <article
                      className={`campus-room campus-room-tone-${item.color} ${roomId === item.id ? "selected" : ""}`}
                      key={item.id}
                    >
                      <span className="campus-room-icon">
                        <Building2 size={24} />
                      </span>
                      <span className="campus-room-content">
                        <button
                          type="button"
                          className="campus-room-select"
                          aria-label={`Выбрать ${item.name}`}
                          aria-pressed={roomId === item.id}
                          onClick={() => setRoomId(item.id)}
                          disabled={Boolean(busy)}
                        >
                          <strong>{item.name}</strong>
                        </button>
                        <span className="campus-room-place">
                          <MapPin size={13} /> {item.building}
                        </span>
                        <span className="campus-room-description">
                          {item.description}
                        </span>
                        <span className="campus-amenities">
                          <span>
                            <Users size={13} /> До {item.capacity} человек
                          </span>
                          {item.amenities.map((amenity) => (
                            <span key={amenity}>{amenity}</span>
                          ))}
                        </span>
                      </span>
                      <span className="campus-room-check">
                        {roomId === item.id && <Check size={16} />}
                      </span>
                    </article>
                  ))}
                </div>
              </div>
              <form className="card campus-booking-form" onSubmit={submit}>
                <p className="campus-eyebrow">Новое бронирование</p>
                <h2>{room?.name || "Выберите помещение"}</h2>
                <div className="campus-form-row">
                  <label>
                    Дата бронирования
                    <input
                      type="date"
                      min={FIRST_DATE}
                      max={LAST_DATE}
                      value={date}
                      onChange={(event) => setDate(event.target.value)}
                      required
                      disabled={Boolean(busy)}
                    />
                  </label>
                  <label>
                    Длительность
                    <select
                      value={duration}
                      onChange={(event) => {
                        setDuration(Number(event.target.value));
                        setStart("");
                      }}
                      disabled={Boolean(busy)}
                    >
                      {[30, 60, 90, 120].map((value) => (
                        <option key={value} value={value}>
                          {value} минут
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <fieldset
                  className="campus-slot-fieldset"
                  disabled={Boolean(busy)}
                >
                  <legend>Начало бронирования · МСК</legend>
                  <p className="campus-muted campus-slot-help">
                    Показаны интервалы на {duration} минут. Серый слот занят или
                    не вмещает выбранную длительность.
                  </p>
                  {slotsLoading && (
                    <p className="campus-loading" role="status">
                      Проверяем доступность…
                    </p>
                  )}
                  {slotsError && (
                    <ErrorNotice
                      retry={() => setReloadSlots((value) => value + 1)}
                    >
                      {slotsError}
                    </ErrorNotice>
                  )}
                  {!slotsLoading && !slotsError && (
                    <div className="campus-slots">
                      {slots.map((slot) => (
                        <button
                          key={slot.start}
                          type="button"
                          className={start === slot.start ? "selected" : ""}
                          aria-label={`${slot.start}, ${canStart(slot) ? "свободно" : "недоступно"}`}
                          aria-pressed={start === slot.start}
                          disabled={!canStart(slot)}
                          onClick={() => setStart(slot.start)}
                        >
                          {slot.start}
                        </button>
                      ))}
                    </div>
                  )}
                </fieldset>
                <label>
                  Цель бронирования
                  <input
                    value={purpose}
                    onChange={(event) => setPurpose(event.target.value)}
                    placeholder="Например, подготовка проекта"
                    minLength={3}
                    maxLength={160}
                    required
                    disabled={Boolean(busy)}
                  />
                </label>
                {validStart && (
                  <p className="campus-selection">
                    <Clock3 size={16} /> {dateLabel(date)}, {start}–{end} ·
                    бесплатно
                  </p>
                )}
                {actionError && <ErrorNotice>{actionError}</ErrorNotice>}
                <button
                  className="button campus-primary"
                  disabled={
                    Boolean(busy) || !validStart || purpose.trim().length < 3
                  }
                >
                  <CalendarDays size={17} />
                  {busy === "booking" ? "Бронируем…" : "Забронировать"}
                </button>
                <p className="campus-form-footnote">
                  Бронь появится в вашей истории. Отменить её можно ниже.
                </p>
              </form>
            </div>
            <section className="card campus-history">
              <div className="campus-section-heading">
                <div>
                  <p className="campus-eyebrow">Твои планы</p>
                  <h2>
                    Мои бронирования{" "}
                    <span className="campus-count">{active.length}</span>
                  </h2>
                </div>
                <div
                  className="campus-filters"
                  role="group"
                  aria-label="Фильтр бронирований"
                >
                  <button
                    type="button"
                    aria-pressed={filter === "active"}
                    onClick={() => setFilter("active")}
                  >
                    Активные
                  </button>
                  <button
                    type="button"
                    aria-pressed={filter === "all"}
                    onClick={() => setFilter("all")}
                  >
                    Вся история
                  </button>
                </div>
              </div>
              {!visible.length ? (
                <div className="campus-empty">
                  <CalendarDays size={27} />
                  <strong>
                    {filter === "active"
                      ? "Пока нет активных бронирований"
                      : "Здесь будет история бронирований"}
                  </strong>
                  <p>Выберите помещение и удобное время выше.</p>
                </div>
              ) : (
                <div className="campus-bookings">
                  {visible.map((booking) => (
                    <article
                      key={booking.id}
                      id={`campus-booking-${booking.id}`}
                      tabIndex={-1}
                      className={`campus-booking ${focusId === booking.id ? "focused" : ""}`}
                    >
                      <div className="campus-booking-date">
                        <strong>{booking.date.slice(-2)}</strong>
                        <span>ноября</span>
                      </div>
                      <div className="campus-booking-info">
                        <h3>{booking.roomName}</h3>
                        <p>
                          {booking.start}–{booking.end} МСК · {booking.purpose}
                        </p>
                        <span
                          className={`campus-status ${booking.status === "confirmed" ? "success" : ""}`}
                        >
                          {booking.status === "confirmed"
                            ? "Подтверждено · демо"
                            : "Отменено"}
                        </span>
                      </div>
                      {booking.status === "confirmed" && (
                        <div className="campus-cancel">
                          {confirmCancel === booking.id ? (
                            <>
                              <p>Освободить это время?</p>
                              <button
                                type="button"
                                className="button secondary"
                                disabled={Boolean(busy)}
                                onClick={() => cancel(booking.id)}
                              >
                                {busy === booking.id
                                  ? "Отменяем…"
                                  : "Да, отменить"}
                              </button>
                              <button
                                type="button"
                                className="campus-text-button"
                                disabled={Boolean(busy)}
                                onClick={() => setConfirmCancel(null)}
                              >
                                Оставить
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="campus-text-button"
                              disabled={Boolean(busy)}
                              onClick={() => setConfirmCancel(booking.id)}
                            >
                              <X size={14} /> Отменить бронь
                            </button>
                          )}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )
      )}
    </section>
  );
}

export function Housing({ notify, focusId, refresh: refreshShell }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const pending = useRef(false);
  const idempotency = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api("/housing", { signal: controller.signal })
      .then(setData)
      .catch((cause) => {
        if (cause.name !== "AbortError") setError(cause.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    if (!focusId || !data) return;
    const node = document.getElementById(`housing-invoice-${focusId}`);
    if (node) {
      node.focus({ preventScroll: true });
      node.scrollIntoView({ block: "center" });
    }
  }, [data, focusId]);
  async function refresh() {
    setData(await api("/housing"));
  }
  async function pay(invoice) {
    if (pending.current) return;
    pending.current = true;
    setBusy(invoice.id);
    setActionError("");
    const body = { invoiceId: invoice.id, mode: data.mode };
    try {
      const response = await api(
        `/housing/invoices/${encodeURIComponent(invoice.id)}/${data.mode === "demo" ? "demo-pay" : "checkout"}`,
        {
          method: "POST",
          headers: { "Idempotency-Key": retryKey(idempotency, body) },
        },
      );
      if (data.mode === "demo") {
        if (!response.invoice?.id || !response.receipt?.id)
          throw new Error(
            "Неполный ответ сервера. Повторите демооплату: новая квитанция создана не будет.",
          );
        setData((current) => ({
          ...current,
          invoices: current.invoices.map((item) =>
            item.id === invoice.id ? response.invoice : item,
          ),
          payments: [
            response.receipt,
            ...current.payments.filter(
              (item) => item.id !== response.receipt.id,
            ),
          ],
        }));
        notify?.("Демооплата учтена. Настоящие деньги не списывались.");
      } else {
        if (!response.payment?.id)
          throw new Error(
            "Неполный ответ сервера. Повторите открытие тестовой оплаты.",
          );
        setData((current) => ({
          ...current,
          payments: [
            response.payment,
            ...current.payments.filter(
              (item) => item.id !== response.payment.id,
            ),
          ],
        }));
        notify?.("Тестовый платёж создан. Откройте защищённую форму YooKassa.");
      }
      idempotency.current = null;
      setConfirm(null);
      Promise.resolve(refreshShell?.()).catch(() => {});
    } catch (cause) {
      setActionError(cause.message);
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }
  async function sync(payment) {
    if (pending.current) return;
    pending.current = true;
    setBusy(payment.id);
    setActionError("");
    try {
      const response = await api(
        `/housing/payments/${encodeURIComponent(payment.id)}/sync`,
        { method: "POST" },
      );
      if (!response.payment?.id)
        throw new Error(
          "Не удалось прочитать статус платежа. Повторите проверку.",
        );
      await refresh();
      notify?.(
        response.payment.status === "succeeded"
          ? "YooKassa подтвердила тестовую оплату"
          : response.payment.status === "canceled"
            ? "Тестовый платёж отменён"
            : "Подтверждения оплаты пока нет. Проверьте позже.",
      );
      Promise.resolve(refreshShell?.()).catch(() => {});
    } catch (cause) {
      setActionError(cause.message);
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }
  const due =
    data?.invoices
      .filter((invoice) => invoice.status === "unpaid")
      .reduce((total, invoice) => total + invoice.amountMinor, 0) || 0;

  return (
    <section className="campus-page housing-page">
      <header className="campus-heading">
        <div>
          <p className="campus-eyebrow">Твой дом в кампусе</p>
          <h1>Общежитие</h1>
          <p>Начисления, история оплат и квитанции — в одном месте.</p>
        </div>
        <span className="campus-week">
          <Home size={16} /> Личный кабинет жильца
        </span>
      </header>
      <DemoNotice>
        <strong>
          {data?.mode === "yookassa-test"
            ? "Тестовая оплата YooKassa."
            : "Демо без настоящих платежей."}
        </strong>{" "}
        Договор и начисления вымышлены. Настоящие деньги не списываются;
        квитанции — образцы.{" "}
        {data?.mode === "yookassa-test"
          ? "Оплата подтверждается сервером, возврат на эту страницу сам по себе ничего не меняет."
          : "Банковские данные не нужны. Платёжный провайдер пока не подключён."}
      </DemoNotice>
      {error && (
        <ErrorNotice retry={() => setReload((value) => value + 1)}>
          {error}
        </ErrorNotice>
      )}
      {loading ? (
        <p className="campus-loading" role="status">
          Загружаем начисления…
        </p>
      ) : (
        data &&
        !error && (
          <>
            <div className="housing-overview">
              <article className="card housing-home">
                <span className="housing-home-icon">
                  <Home size={30} />
                </span>
                <div>
                  <p className="campus-eyebrow">Место проживания · демо</p>
                  <h2>{data.account.residence}</h2>
                  <p>
                    Комната {data.account.room} · договор{" "}
                    {data.account.contractNumber}
                  </p>
                  <span>{data.account.tenant}</span>
                </div>
              </article>
              <article className="card housing-balance">
                <p className="campus-eyebrow">К оплате по демоначислениям</p>
                <strong>{money(due)}</strong>
                <span>
                  {due
                    ? "Начисления за ноябрь уже доступны"
                    : "Все демоначисления оплачены"}
                </span>
              </article>
            </div>
            <section className="card housing-invoices">
              <div className="campus-section-heading">
                <div>
                  <p className="campus-eyebrow">Прозрачно и по месяцам</p>
                  <h2>Начисления</h2>
                </div>
                <span className="campus-muted">Валюта: российский рубль</span>
              </div>
              {actionError && <ErrorNotice>{actionError}</ErrorNotice>}
              {data.mode === "yookassa-test" && !data.providerConfigured && (
                <ErrorNotice>
                  Тестовый магазин YooKassa пока не настроен. Организатор может
                  добавить ключи тестового магазина на сервере.
                </ErrorNotice>
              )}
              <div className="housing-invoice-list">
                {data.invoices.map((invoice) => {
                  const payment = data.payments.find(
                    (item) =>
                      item.invoiceId === invoice.id &&
                      ["pending", "creating"].includes(item.status),
                  );
                  return (
                    <article
                      key={invoice.id}
                      id={`housing-invoice-${invoice.id}`}
                      tabIndex={-1}
                      className={`housing-invoice ${focusId === invoice.id ? "focused" : ""}`}
                    >
                      <div className="housing-invoice-title">
                        <span className="housing-invoice-icon">
                          {invoice.status === "paid" ? (
                            <CheckCircle2 size={23} />
                          ) : (
                            <CalendarDays size={23} />
                          )}
                        </span>
                        <div>
                          <h3>{periodLabel(invoice.period)}</h3>
                          <p>
                            Проживание · оплатить до{" "}
                            {dateLabel(invoice.dueDate)}
                          </p>
                          <span
                            className={`campus-status ${invoice.status === "paid" ? "success" : "pending"}`}
                          >
                            {invoice.status === "paid"
                              ? "Оплачено · демо"
                              : "Ожидает оплаты"}
                          </span>
                        </div>
                      </div>
                      <div className="housing-invoice-actions">
                        <strong>{money(invoice.amountMinor)}</strong>
                        {invoice.status === "paid" ? (
                          <a
                            className="campus-text-button"
                            href={`/api/housing/invoices/${encodeURIComponent(invoice.id)}/receipt`}
                            download
                          >
                            <Download size={15} /> Скачать образец квитанции
                          </a>
                        ) : (
                          <>
                            {payment?.confirmationUrl && (
                              <a
                                className="button secondary"
                                href={payment.confirmationUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <ArrowUpRight size={16} /> Открыть тестовую
                                форму
                              </a>
                            )}
                            {payment?.status === "pending" ? (
                              <button
                                className="button secondary"
                                type="button"
                                disabled={Boolean(busy)}
                                onClick={() => sync(payment)}
                              >
                                <RefreshCw size={15} />{" "}
                                {busy === payment.id
                                  ? "Проверяем…"
                                  : "Проверить тестовую оплату"}
                              </button>
                            ) : confirm === invoice.id ? (
                              <div className="housing-confirm">
                                <p>
                                  {data.mode === "demo"
                                    ? `Учесть ${money(invoice.amountMinor)} как демооплату? Настоящие деньги не списываются.`
                                    : "Создать платёж в тестовом магазине YooKassa? Используйте только тестовые банковские данные провайдера."}
                                </p>
                                <button
                                  className="button"
                                  type="button"
                                  disabled={Boolean(busy)}
                                  onClick={() => pay(invoice)}
                                >
                                  {busy === invoice.id
                                    ? "Обрабатываем…"
                                    : data.mode === "demo"
                                      ? "Подтвердить демооплату"
                                      : "Создать тестовый платёж"}
                                </button>
                                <button
                                  className="campus-text-button"
                                  type="button"
                                  disabled={Boolean(busy)}
                                  onClick={() => setConfirm(null)}
                                >
                                  Отмена
                                </button>
                              </div>
                            ) : (
                              <button
                                className="button"
                                type="button"
                                disabled={
                                  Boolean(busy) ||
                                  (data.mode !== "demo" &&
                                    !data.providerConfigured)
                                }
                                onClick={() => setConfirm(invoice.id)}
                              >
                                {data.mode === "demo"
                                  ? "Демо: оплатить"
                                  : payment?.status === "creating"
                                    ? "Повторить открытие оплаты"
                                    : "Перейти к тестовой оплате"}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
            <section className="card housing-history">
              <div className="campus-section-heading">
                <div>
                  <p className="campus-eyebrow">Сохранено в твоём кабинете</p>
                  <h2>История операций</h2>
                </div>
              </div>
              {!data.payments.length ? (
                <p className="campus-empty">Операций пока нет.</p>
              ) : (
                <div className="housing-payment-list">
                  {data.payments.map((payment) => (
                    <article key={payment.id}>
                      <span
                        className={`housing-payment-dot ${payment.status === "succeeded" ? "success" : "pending"}`}
                      />
                      <div>
                        <strong>
                          {payment.status === "succeeded"
                            ? "Оплата учтена"
                            : payment.status === "canceled"
                              ? "Платёж отменён"
                              : payment.status === "creating"
                                ? "Создание платежа не завершено"
                                : "Ожидается подтверждение"}
                        </strong>
                        <p>
                          {payment.mode === "demo"
                            ? "Локальная демонстрация"
                            : "Тестовый магазин YooKassa"}{" "}
                          · {payment.number}
                        </p>
                      </div>
                      <span>{money(payment.amountMinor)}</span>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )
      )}
    </section>
  );
}
