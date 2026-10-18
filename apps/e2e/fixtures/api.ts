import { API_URL, WEB_URL } from './env';

export interface ApiErrorBody {
  error?: { code?: string; message?: string; details?: { field?: string; issue?: string }[] };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: unknown,
  ) {
    super(`${status} ${code}: ${message}`);
  }
}

export interface ApiResponse<T> {
  status: number;
  body: T;
  headers: Headers;
}

export interface CallOptions {
  token?: string;
  body?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
  /** Throws `ApiError` when the status is not in this list (default: any 2xx). */
  expect?: number | number[];
}

/**
 * Thin fetch wrapper for the API under test. Sends the web origin so the
 * CSRF / origin checks see a browser-like caller; bearer tokens are the only
 * credential (fixtures log in as `client: 'mobile'` and never hold cookies).
 */
export async function call<T = unknown>(
  method: string,
  pathname: string,
  options: CallOptions = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    origin: WEB_URL,
    ...(options.headers ?? {}),
  };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  const response = await fetch(`${API_URL}${pathname}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : options.form,
    redirect: 'manual',
  });
  const text = await response.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  const allowed =
    options.expect === undefined
      ? response.ok
      : (Array.isArray(options.expect) ? options.expect : [options.expect]).includes(
          response.status,
        );
  if (!allowed) {
    const error = (parsed as ApiErrorBody | undefined)?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'HTTP_ERROR',
      `${method} ${pathname} → ${error?.message ?? text.slice(0, 300)}`,
      parsed,
    );
  }
  return { status: response.status, body: parsed as T, headers: response.headers };
}

/** Query string from a plain object, skipping undefined values. */
export function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** Form-encoded POST (what a browser form does); redirects are not followed. */
export async function postForm(
  url: string,
  fields: Record<string, string>,
): Promise<{ status: number; location: string | null; text: string }> {
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'text/html,application/json',
    },
    body: new URLSearchParams(fields).toString(),
  });
  return {
    status: response.status,
    location: response.headers.get('location'),
    text: await response.text(),
  };
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `probe` until it returns a non-undefined value or the timeout passes. */
export async function waitFor<T>(
  probe: () => Promise<T | undefined>,
  options: { timeoutMs?: number; intervalMs?: number; what: string },
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 500;
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await probe();
      if (value !== undefined) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  const suffix = lastError ? ` (last error: ${String(lastError)})` : '';
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${options.what}${suffix}`);
}
