import { randomUUID, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { request } from "node:https";
import { getCACertificates } from "node:tls";

const OAUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
const CHAT_URL = "https://api.giga.chat/v1/chat/completions";
const SCOPES = new Set([
  "GIGACHAT_API_PERS",
  "GIGACHAT_API_B2B",
  "GIGACHAT_API_CORP",
]);
const DEFAULT_MODEL = "GigaChat-3-Pro";
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function postJson(url, { headers, body, signal, ca }) {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          ...headers,
          "Content-Length": Buffer.byteLength(body),
        },
        signal,
        ca,
        rejectUnauthorized: true,
      },
      async (res) => {
        try {
          if (res.statusCode !== 200) {
            res.destroy();
            return resolve({ status: res.statusCode });
          }
          const chunks = [];
          let bytes = 0;
          for await (const chunk of res) {
            bytes += chunk.length;
            if (bytes > 32_768) throw new Error("Oversized GigaChat response");
            chunks.push(chunk);
          }
          resolve({
            status: res.statusCode,
            payload: JSON.parse(Buffer.concat(chunks)),
          });
        } catch (error) {
          reject(error);
        }
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

export function createGigaChat(db, options = {}) {
  const credentials = (
    options.credentials ??
    process.env.GIGACHAT_CREDENTIALS ??
    ""
  ).trim();
  const scope = (options.scope ?? process.env.GIGACHAT_SCOPE ?? "").trim();
  const model =
    (options.model ?? process.env.GIGACHAT_MODEL ?? "").trim() || DEFAULT_MODEL;
  const caFile = options.caFile ?? process.env.GIGACHAT_CA_FILE;
  const requested = Boolean(credentials || scope);
  let configured = Boolean(
    credentials && SCOPES.has(scope) && MODEL_ID.test(model),
  );
  let ca;
  if (configured && caFile) {
    try {
      const pem = readFileSync(caFile, "utf8");
      const certificates = pem.match(
        /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
      );
      if (!certificates?.length) throw new Error("Missing CA certificates");
      for (const certificate of certificates)
        if (!new X509Certificate(certificate).ca)
          throw new Error("Expected CA certificate");
      ca = [...getCACertificates("default"), ...certificates];
    } catch {
      configured = false;
    }
  }
  const send = options.postJson ?? postJson;
  const now = options.now ?? Date.now;
  let token;
  let pending = false;
  let reserve;
  let prune;
  if (configured) {
    db.exec(
      "CREATE TABLE IF NOT EXISTS assistant_gigachat_quota (started_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS gigachat_quota_started ON assistant_gigachat_quota(started_at)",
    );
    prune = db.prepare(
      "DELETE FROM assistant_gigachat_quota WHERE started_at <= ?",
    );
    reserve = db.prepare(`
      INSERT INTO assistant_gigachat_quota(started_at)
      SELECT ?
      WHERE (SELECT COUNT(*) FROM assistant_gigachat_quota WHERE started_at > ?) < 6
        AND (SELECT COUNT(*) FROM assistant_gigachat_quota WHERE started_at > ?) < 60
    `);
  }

  async function accessToken(signal) {
    if (token && token.expiresAt > now() + 30_000) return token.value;
    const response = await send(OAUTH_URL, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
        RqUID: randomUUID(),
      },
      body: new URLSearchParams({ scope }).toString(),
      signal,
      ca,
    });
    const { access_token: value, expires_at: expiresAtRaw } =
      response.payload ?? {};
    if (
      response.status !== 200 ||
      typeof value !== "string" ||
      !/^[\x21-\x7e]{1,4096}$/.test(value)
    )
      throw new Error("GigaChat authorization failed");
    const currentTime = now();
    if (!Number.isSafeInteger(expiresAtRaw))
      throw new Error("Invalid GigaChat token expiry");
    const expiresAt =
      expiresAtRaw < 10_000_000_000 ? expiresAtRaw * 1000 : expiresAtRaw;
    if (expiresAt <= currentTime) throw new Error("Expired GigaChat token");
    token = {
      value,
      expiresAt: Math.min(expiresAt, currentTime + 30 * MINUTE),
    };
    return value;
  }

  async function complete(messages) {
    if (!configured) throw new Error("GigaChat is not configured");
    const body = JSON.stringify({
      model,
      messages,
      temperature: 0.1,
      max_tokens: 320,
      stream: false,
      function_call: "none",
    });
    if (Buffer.byteLength(body) > 8_192)
      throw new Error("Oversized GigaChat request");
    if (pending) return { busy: true };
    const start = now();
    prune.run(start - DAY);
    if (!reserve.run(start, start - MINUTE, start - DAY).changes)
      return { limited: true };
    pending = true;
    const signal = AbortSignal.timeout(options.timeoutMs ?? 8_000);
    try {
      const authorization = await accessToken(signal);
      const response = await send(CHAT_URL, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authorization}`,
        },
        body,
        signal,
        ca,
      });
      if (response.status === 401) token = undefined;
      if (response.status !== 200)
        throw new Error("Unexpected GigaChat response status");
      const { model: actualModel, choices } = response.payload ?? {};
      const choice = choices?.[0];
      const content = choice?.message?.content;
      if (
        typeof actualModel !== "string" ||
        !MODEL_ID.test(actualModel) ||
        (actualModel !== model && !actualModel.startsWith(`${model}:`)) ||
        !Array.isArray(choices) ||
        choices.length !== 1 ||
        choice?.finish_reason !== "stop" ||
        choice.message?.role !== "assistant" ||
        choice.message.function_call ||
        choice.message.tool_calls?.length ||
        typeof content !== "string" ||
        !content.trim() ||
        content.length > 2400
      )
        throw Object.assign(new Error("Unexpected GigaChat response"), {
          code: "INVALID_COMPLETION",
        });
      return { model: actualModel, content: content.trim() };
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof SyntaxError)
        throw Object.assign(new Error("Invalid provider JSON"), {
          code: "INVALID_COMPLETION",
        });
      throw error;
    } finally {
      pending = false;
    }
  }

  return {
    requested,
    configured,
    complete,
    status: () => ({
      mode: configured ? "gigachat" : "local",
      configured,
      provider: configured ? "GigaChat" : null,
      model: configured ? model : null,
      disclosure: configured
        ? "С вашего разрешения GigaChat получает вопрос и, для уточнения, один связанный вопрос, ранее отправленный модели. Для вопросов о кабинете добавляются подходящие публичные источники. Записи аккаунта и загруженные файлы остаются в кабинете."
        : "Настройки GigaChat неполные, либо сервер не смог загрузить файл доверенных сертификатов. Вопросы обрабатывает локальный демопомощник.",
    }),
  };
}
