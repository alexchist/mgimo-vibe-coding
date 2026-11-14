let csrfToken = '';
export async function api(path, options = {}) {
  const { body, headers, ...rest } = options;
  const payloadBody = body === undefined && ['POST', 'PUT', 'PATCH', 'DELETE'].includes((rest.method || 'GET').toUpperCase()) ? {} : body;
  const response = await fetch(`/api${path}`, {
    ...rest,
    credentials: 'same-origin',
    headers: { ...(payloadBody !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}), ...headers },
    ...(payloadBody !== undefined ? { body: JSON.stringify(payloadBody) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || payload.message || 'Не удалось выполнить запрос. Попробуйте ещё раз.');
    error.status = response.status;
    if (response.status === 401 && path !== '/login' && path !== '/session') window.dispatchEvent(new Event('orbita:unauthorized'));
    throw error;
  }
  return payload;
}
api.setCsrf = (token) => { csrfToken = token || ''; };
export default api;
