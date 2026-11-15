const ENDPOINT = "https://ai.api.cloud.yandex.net/v1/chat/completions";

/** Server-only OpenAI-compatible Yandex AI adapter. No credentials leave this module. */
export function createYandexAI(options = {}) {
  const apiKey = options.apiKey ?? process.env.YANDEX_API_KEY;
  const folderId = options.folderId ?? process.env.YANDEX_FOLDER_ID;
  const modelUri = options.modelUri ?? process.env.YANDEX_MODEL_URI;
  const request = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15000;
  const configured = Boolean(apiKey && folderId && modelUri);

  async function complete({ messages, tools, json = false }) {
    if (!configured) throw new Error("Внешняя нейросеть не настроена.");
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const response = await request(ENDPOINT, {
            method: "POST",
            redirect: "error",
            signal: controller.signal,
            headers: {
              Authorization: `Api-Key ${apiKey}`,
              "OpenAI-Project": folderId,
              "Content-Type": "application/json",
              "x-data-logging-enabled": "false",
            },
            body: JSON.stringify({
              model: modelUri,
              messages,
              temperature: 0.1,
              max_tokens: 1200,
              ...(tools?.length ? { tools, tool_choice: "auto" } : {}),
              ...(json ? { response_format: { type: "json_object" } } : {}),
            }),
          });
          if (!response.ok) throw new Error("AI unavailable");
          let payload;
          if (response.body?.getReader) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let size = 0;
            let content = "";
            try {
              while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;
                size += chunk.value.byteLength;
                if (size > 64000) throw new Error("Oversized AI payload");
                content += decoder.decode(chunk.value, { stream: true });
              }
              content += decoder.decode();
              payload = JSON.parse(content);
            } finally {
              await reader.cancel().catch(() => {});
            }
          } else payload = await response.json();
          const message = payload?.choices?.[0]?.message;
          if (
            !message ||
            (typeof message.content !== "string" &&
              !Array.isArray(message.tool_calls))
          )
            throw new Error("Invalid AI response");
          if (
            JSON.stringify(message).length > 16000 ||
            (typeof message.content === "string" &&
              message.content.length > 12000)
          )
            throw new Error("Oversized AI response");
          return message;
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("AI timeout"));
          }, timeoutMs);
        }),
      ]);
    } catch {
      // Provider payloads can contain request details. Never surface them to users/logs.
      throw new Error(
        "Yandex AI сейчас недоступен или модель не поддерживает этот запрос.",
      );
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  return {
    configured,
    complete,
    status: () => ({
      mode: configured ? "yandex" : "local",
      configured,
      provider: configured ? "Yandex AI" : null,
      model: configured
        ? modelUri.split("/").slice(3).join("/") || "Настроенная модель"
        : null,
      disclosure: configured
        ? "Вопрос и необходимые фрагменты ваших данных отправляются в Yandex AI. Действия требуют отдельного подтверждения."
        : "Локальный демопомощник. Внешняя нейросеть не подключена; вопросы не уходят во внешние сервисы.",
    }),
  };
}
