let csrfToken = "";
export async function api(path, options = {}) {
  const { body, headers, ...rest } = options;
  const requestCsrf = csrfToken;
  const payloadBody =
    body === undefined &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(
      (rest.method || "GET").toUpperCase(),
    )
      ? {}
      : body;
  let response;
  try {
    response = await fetch(`/api${path}`, {
      ...rest,
      credentials: "same-origin",
      headers: {
        ...(payloadBody !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...(requestCsrf ? { "X-CSRF-Token": requestCsrf } : {}),
        ...headers,
      },
      ...(payloadBody !== undefined
        ? { body: JSON.stringify(payloadBody) }
        : {}),
    });
  } catch (cause) {
    if (cause.name === "AbortError") throw cause;
    throw new Error(
      "Не удалось связаться с сервером. Проверьте соединение и попробуйте ещё раз.",
      { cause },
    );
  }
  let payload;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new Error(
      "Не удалось прочитать ответ сервера. Повторите действие, когда соединение восстановится.",
      { cause },
    );
  }
  if (!response.ok) {
    const error = new Error(
      payload.error ||
        payload.message ||
        "Не удалось выполнить запрос. Попробуйте ещё раз.",
    );
    error.status = response.status;
    if (
      response.status === 401 &&
      requestCsrf === csrfToken &&
      path !== "/login" &&
      path !== "/session"
    )
      window.dispatchEvent(new Event("orbita:unauthorized"));
    throw error;
  }
  return payload;
}
api.setCsrf = (token) => {
  csrfToken = token || "";
};
export default api;
