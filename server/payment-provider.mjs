const API = "https://api.yookassa.ru/v3/payments";
const fail = (status, message) =>
  Object.assign(new Error(message), { status, expose: true });

export function createPaymentProvider(options = {}) {
  const mode = options.paymentMode ?? process.env.PAYMENTS_MODE ?? "demo";
  const shopId = options.shopId ?? process.env.YOOKASSA_SHOP_ID;
  const secretKey = options.secretKey ?? process.env.YOOKASSA_SECRET_KEY;
  const returnUrl = options.returnUrl ?? process.env.YOOKASSA_RETURN_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  let validReturnUrl = false;
  try {
    const url = new URL(returnUrl);
    validReturnUrl =
      url.protocol === "https:" && !url.username && !url.password;
  } catch {
    /* Not configured. */
  }
  // Never send a payment creation request using a live shop secret, even by mistake.
  const configured =
    mode === "yookassa-test" &&
    Boolean(
      shopId &&
      typeof secretKey === "string" &&
      secretKey.startsWith("test_") &&
      validReturnUrl,
    );

  async function request(path, options = {}) {
    if (!configured)
      throw fail(
        503,
        "Тестовый платёжный провайдер не настроен. Обратитесь к организатору демонстрации.",
      );
    let response;
    try {
      response = await fetchImpl(path, {
        ...options,
        headers: {
          Authorization: `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString("base64")}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
        signal: AbortSignal.timeout(10000),
        redirect: "error",
      });
    } catch {
      throw fail(
        502,
        "Не удалось связаться с тестовым платёжным сервисом. Повторите проверку позже; не создавайте новый платёж.",
      );
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload)
      throw fail(
        502,
        "Платёжный сервис не подтвердил операцию. Повторите проверку позже.",
      );
    if (payload.test !== true)
      throw fail(
        502,
        "Провайдер вернул не тестовый платёж. Операция остановлена; используйте ключи тестового магазина.",
      );
    if (
      typeof payload.id !== "string" ||
      !/^[a-zA-Z0-9-]{1,100}$/.test(payload.id)
    )
      throw fail(502, "Некорректный ответ тестового платёжного сервиса.");
    return payload;
  }
  return {
    mode: mode === "demo" ? "demo" : "yookassa-test",
    configured,
    async createPayment({ key, invoiceId, userId, amountMinor }) {
      const result = await request(API, {
        method: "POST",
        headers: { "Idempotence-Key": key },
        body: JSON.stringify({
          amount: { value: (amountMinor / 100).toFixed(2), currency: "RUB" },
          capture: true,
          confirmation: { type: "redirect", return_url: returnUrl },
          description: "Орбита: тестовая оплата вымышленного общежития",
          metadata: { orbita_invoice_id: invoiceId, orbita_user_id: userId },
        }),
      });
      if (result.confirmation?.confirmation_url) {
        let url;
        try {
          url = new URL(result.confirmation.confirmation_url);
        } catch {
          throw fail(502, "Платёжный сервис не вернул корректную ссылку.");
        }
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          !["yoomoney.ru", "yookassa.ru"].some(
            (host) =>
              url.hostname === host || url.hostname.endsWith(`.${host}`),
          )
        )
          throw fail(
            502,
            "Платёжный сервис вернул неподдерживаемый адрес оплаты.",
          );
      }
      return result;
    },
    async getPayment(id) {
      if (typeof id !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(id))
        throw fail(400, "Некорректный идентификатор платежа.");
      return request(`${API}/${encodeURIComponent(id)}`, { method: "GET" });
    },
  };
}
