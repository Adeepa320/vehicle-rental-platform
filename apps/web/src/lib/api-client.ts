import {
  ApiErrorSchema,
  AuthSessionResponseSchema,
  HealthResponseSchema,
  MessageResponseSchema,
  ReadyResponseSchema,
  RegisterResponseSchema,
  UserSchema,
  VerifyEmailResponseSchema,
  type ApiErrorDetail,
  type AuthSessionResponse,
  type HealthResponse,
  type LoginRequest,
  type MessageResponse,
  type ReadyResponse,
  type RegisterRequest,
  type RegisterResponse,
  type UpdateProfileRequest,
  type User,
  type VerifyEmailResponse,
} from '@vrp/contracts';
import { z, type ZodType } from 'zod';

/** Thrown when the API answers with its error envelope or an unexpected shape. */
export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly details?: ApiErrorDetail[],
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export interface ApiClientOptions {
  /** e.g. `http://localhost:4000/api/v1` */
  baseUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  accessToken?: string;
  /** Non-2xx statuses whose body is still parsed with the success schema (e.g. 503 for /ready). */
  allowStatuses?: number[];
  /** Send and accept the HttpOnly refresh cookie (auth endpoints only). */
  withCredentials?: boolean;
}

const NoContentSchema = z.undefined();

/**
 * Typed client over `fetch`. Every response is validated against the shared
 * contract so the UI never trusts an unexpected payload. The access token is
 * passed explicitly by the auth provider; it is never persisted by this module.
 */
export function createApiClient(options: ApiClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;

  async function request<T>(
    path: string,
    schema: ZodType<T>,
    opts: RequestOptions = {},
  ): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        accept: 'application/json',
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opts.accessToken ? { authorization: `Bearer ${opts.accessToken}` } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      credentials: opts.withCredentials ? 'include' : 'same-origin',
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });

    const body: unknown =
      response.status === 204 ? undefined : await response.json().catch(() => undefined);

    if (!response.ok && !(opts.allowStatuses ?? []).includes(response.status)) {
      const parsed = ApiErrorSchema.safeParse(body);
      if (parsed.success) {
        const { code, message, requestId, details } = parsed.data.error;
        throw new ApiClientError(response.status, code, message, requestId, details);
      }
      throw new ApiClientError(
        response.status,
        'INTERNAL',
        `Request to ${path} failed with status ${response.status}`,
      );
    }

    const result = schema.safeParse(body);
    if (!result.success) {
      throw new ApiClientError(
        response.status,
        'INTERNAL',
        `Unexpected response shape from ${path}`,
      );
    }
    return result.data;
  }

  return {
    getHealth: (): Promise<HealthResponse> => request('/health', HealthResponseSchema),
    getReadiness: (): Promise<ReadyResponse> =>
      request('/ready', ReadyResponseSchema, { allowStatuses: [503] }),

    auth: {
      register: (body: RegisterRequest): Promise<RegisterResponse> =>
        request('/auth/register', RegisterResponseSchema, { method: 'POST', body }),
      login: (body: LoginRequest): Promise<AuthSessionResponse> =>
        request('/auth/login', AuthSessionResponseSchema, {
          method: 'POST',
          body,
          withCredentials: true,
        }),
      refresh: (): Promise<AuthSessionResponse> =>
        request('/auth/refresh', AuthSessionResponseSchema, {
          method: 'POST',
          body: {},
          withCredentials: true,
        }),
      logout: (): Promise<void> =>
        request('/auth/logout', NoContentSchema, {
          method: 'POST',
          body: {},
          withCredentials: true,
        }),
      logoutAll: (accessToken: string): Promise<void> =>
        request('/auth/logout-all', NoContentSchema, {
          method: 'POST',
          accessToken,
          withCredentials: true,
        }),
      verifyEmail: (token: string): Promise<VerifyEmailResponse> =>
        request('/auth/email/verify', VerifyEmailResponseSchema, {
          method: 'POST',
          body: { token },
        }),
      resendVerification: (email: string): Promise<MessageResponse> =>
        request('/auth/email/resend-verification', MessageResponseSchema, {
          method: 'POST',
          body: { email },
        }),
      forgotPassword: (email: string): Promise<MessageResponse> =>
        request('/auth/password/forgot', MessageResponseSchema, {
          method: 'POST',
          body: { email },
        }),
      resetPassword: (token: string, newPassword: string): Promise<MessageResponse> =>
        request('/auth/password/reset', MessageResponseSchema, {
          method: 'POST',
          body: { token, newPassword },
        }),
    },

    users: {
      me: (accessToken: string): Promise<User> => request('/users/me', UserSchema, { accessToken }),
      updateMe: (accessToken: string, body: UpdateProfileRequest): Promise<User> =>
        request('/users/me', UserSchema, { method: 'PATCH', body, accessToken }),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
