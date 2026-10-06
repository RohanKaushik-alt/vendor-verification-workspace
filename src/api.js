/**
 * Thin API client: every call returns parsed JSON and throws a normal Error
 * with the server message so components can show a toast.
 */

async function request(path, options = {}) {
  const { body, formData, method = 'POST' } = options;
  const init = { method, headers: {} };

  if (formData) {
    init.body = formData;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(path, init);
  } catch (err) {
    throw new Error(`Cannot reach the API: ${err.message}. Is the backend running?`);
  }

  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const details = payload.details
      ? ` (${payload.details.map?.((d) => d.message).join(', ') || JSON.stringify(payload.details)})`
      : '';
    const error = new Error(`${payload.error || response.statusText}${details}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export const api = {
  get: (path) => request(path, { method: 'GET' }),
  post: (path, body) => request(path, { body }),
  patch: (path, body) => request(path, { body, method: 'PATCH' }),
  del: (path) => request(path, { method: 'DELETE' }),
  upload: (path, formData) => request(path, { formData }),
};
