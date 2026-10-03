import {
  AdminProviderApplicationListSchema,
  AdminProviderApplicationSchema,
  AdminProviderDetailSchema,
  AdminProviderListSchema,
  ApiErrorSchema,
  AuthSessionResponseSchema,
  DistrictSchema,
  HealthResponseSchema,
  MessageResponseSchema,
  PlaceSummarySchema,
  ProviderApplicationSchema,
  ProviderProfileSchema,
  ReadyResponseSchema,
  RegisterResponseSchema,
  UserSchema,
  VehicleCategorySchema,
  VerifyEmailResponseSchema,
  type AdminProviderApplication,
  type AdminProviderApplicationList,
  type AdminProviderDetail,
  type AdminProviderList,
  type ApiErrorDetail,
  type AuthSessionResponse,
  type District,
  type HealthResponse,
  type LoginRequest,
  type MessageResponse,
  type PlaceSummary,
  type ProviderApplication,
  type ProviderApplicationDraft,
  type ProviderApplicationStatus,
  type ProviderProfile,
  type ProviderStatus,
  type ReadyResponse,
  type RegisterRequest,
  type RegisterResponse,
  type UpdateProfileRequest,
  type UpdateProviderProfileRequest,
  type User,
  type VehicleCategory,
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
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
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
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const queryString = params.toString();
    const response = await fetchImpl(`${baseUrl}${path}${queryString ? `?${queryString}` : ''}`, {
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

  const withToken = (accessToken: string) => ({ accessToken });

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
      me: (accessToken: string): Promise<User> =>
        request('/users/me', UserSchema, withToken(accessToken)),
      updateMe: (accessToken: string, body: UpdateProfileRequest): Promise<User> =>
        request('/users/me', UserSchema, { method: 'PATCH', body, accessToken }),
    },

    reference: {
      districts: (): Promise<District[]> =>
        request('/reference/districts', z.array(DistrictSchema)),
      places: (districtId?: string): Promise<PlaceSummary[]> =>
        request('/reference/places', z.array(PlaceSummarySchema), { query: { districtId } }),
      vehicleCategories: (): Promise<VehicleCategory[]> =>
        request('/reference/vehicle-categories', z.array(VehicleCategorySchema)),
    },

    providers: {
      /** Resolves `null` when the user has not started an application. */
      myApplication: async (accessToken: string): Promise<ProviderApplication | null> => {
        try {
          return await request(
            '/providers/me/application',
            ProviderApplicationSchema,
            withToken(accessToken),
          );
        } catch (error) {
          if (error instanceof ApiClientError && error.status === 404) return null;
          throw error;
        }
      },
      saveApplication: (
        accessToken: string,
        body: ProviderApplicationDraft,
      ): Promise<ProviderApplication> =>
        request('/providers/me/application', ProviderApplicationSchema, {
          method: 'PUT',
          body,
          accessToken,
        }),
      submitApplication: (accessToken: string): Promise<ProviderApplication> =>
        request('/providers/me/application/submit', ProviderApplicationSchema, {
          method: 'POST',
          body: { acceptProviderAgreement: true },
          accessToken,
        }),
      /** Resolves `null` when the user is not an approved provider. */
      myProfile: async (accessToken: string): Promise<ProviderProfile | null> => {
        try {
          return await request('/providers/me', ProviderProfileSchema, withToken(accessToken));
        } catch (error) {
          if (error instanceof ApiClientError && error.status === 404) return null;
          throw error;
        }
      },
      updateProfile: (
        accessToken: string,
        body: UpdateProviderProfileRequest,
      ): Promise<ProviderProfile> =>
        request('/providers/me', ProviderProfileSchema, { method: 'PATCH', body, accessToken }),
    },

    admin: {
      listApplications: (
        accessToken: string,
        query: { status?: ProviderApplicationStatus; cursor?: string; limit?: number } = {},
      ): Promise<AdminProviderApplicationList> =>
        request('/admin/provider-applications', AdminProviderApplicationListSchema, {
          accessToken,
          query,
        }),
      getApplication: (accessToken: string, id: string): Promise<AdminProviderApplication> =>
        request(
          `/admin/provider-applications/${id}`,
          AdminProviderApplicationSchema,
          withToken(accessToken),
        ),
      startReview: (accessToken: string, id: string): Promise<AdminProviderApplication> =>
        request(`/admin/provider-applications/${id}/start-review`, AdminProviderApplicationSchema, {
          method: 'POST',
          body: {},
          accessToken,
        }),
      requestChanges: (
        accessToken: string,
        id: string,
        reason: string,
      ): Promise<AdminProviderApplication> =>
        request(
          `/admin/provider-applications/${id}/request-changes`,
          AdminProviderApplicationSchema,
          {
            method: 'POST',
            body: { reason },
            accessToken,
          },
        ),
      approve: (
        accessToken: string,
        id: string,
        adminNotes?: string,
      ): Promise<AdminProviderApplication> =>
        request(`/admin/provider-applications/${id}/approve`, AdminProviderApplicationSchema, {
          method: 'POST',
          body: adminNotes ? { adminNotes } : {},
          accessToken,
        }),
      reject: (
        accessToken: string,
        id: string,
        reason: string,
      ): Promise<AdminProviderApplication> =>
        request(`/admin/provider-applications/${id}/reject`, AdminProviderApplicationSchema, {
          method: 'POST',
          body: { reason },
          accessToken,
        }),
      listProviders: (
        accessToken: string,
        query: { status?: ProviderStatus; cursor?: string; limit?: number } = {},
      ): Promise<AdminProviderList> =>
        request('/admin/providers', AdminProviderListSchema, { accessToken, query }),
      getProvider: (accessToken: string, id: string): Promise<AdminProviderDetail> =>
        request(`/admin/providers/${id}`, AdminProviderDetailSchema, withToken(accessToken)),
      suspendProvider: (
        accessToken: string,
        id: string,
        reason: string,
      ): Promise<AdminProviderDetail> =>
        request(`/admin/providers/${id}/suspend`, AdminProviderDetailSchema, {
          method: 'POST',
          body: { reason },
          accessToken,
        }),
      reactivateProvider: (
        accessToken: string,
        id: string,
        note?: string,
      ): Promise<AdminProviderDetail> =>
        request(`/admin/providers/${id}/reactivate`, AdminProviderDetailSchema, {
          method: 'POST',
          body: note ? { note } : {},
          accessToken,
        }),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
