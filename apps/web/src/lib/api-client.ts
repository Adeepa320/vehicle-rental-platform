import {
  AdminBookingListSchema,
  AdminBookingSchema,
  AdminProviderApplicationListSchema,
  AdminProviderApplicationSchema,
  AdminProviderDetailSchema,
  AdminProviderListSchema,
  AdminVehicleListSchema,
  AdminVehicleSchema,
  ApiErrorSchema,
  AuthSessionResponseSchema,
  BookingContactSchema,
  BookingListSchema,
  BookingQuoteSchema,
  BookingSchema,
  DistrictSchema,
  HealthResponseSchema,
  MessageResponseSchema,
  PlaceSuggestionSchema,
  PlaceSummarySchema,
  ProviderApplicationSchema,
  ProviderLocationListSchema,
  ProviderLocationSchema,
  ProviderProfileSchema,
  PublicVehicleDetailSchema,
  ReadyResponseSchema,
  RegisterResponseSchema,
  UserSchema,
  VehicleAvailabilitySchema,
  VehicleCategorySchema,
  VehicleHoldListSchema,
  VehicleHoldSchema,
  VehicleListSchema,
  VehiclePhotoListSchema,
  VehiclePhotoSchema,
  VehicleSchema,
  VehicleSearchResponseSchema,
  VerifyEmailResponseSchema,
  type AcceptBookingRequest,
  type AdminBooking,
  type AdminBookingList,
  type AdminProviderApplication,
  type AdminProviderApplicationList,
  type AdminProviderDetail,
  type AdminProviderList,
  type AdminVehicle,
  type AdminVehicleList,
  type ApiErrorDetail,
  type AuthSessionResponse,
  type Booking,
  type BookingContact,
  type BookingList,
  type BookingQuote,
  type BookingScope,
  type BookingStatus,
  type CancelBookingRequest,
  type ConfirmBookingForTestingRequest,
  type CreateAvailabilityBlockRequest,
  type CreateBookingRequest,
  type CreateProviderLocationRequest,
  type CreateVehicleRequest,
  type DeclineBookingRequest,
  type District,
  type HandoverRequest,
  type HealthResponse,
  type LoginRequest,
  type MessageResponse,
  type NoShowBookingRequest,
  type PlaceSuggestion,
  type PlaceSummary,
  type ProviderApplication,
  type ProviderApplicationDraft,
  type ProviderApplicationStatus,
  type ProviderLocation,
  type ProviderProfile,
  type ProviderStatus,
  type PublicVehicleDetail,
  type ReadyResponse,
  type RegisterRequest,
  type RegisterResponse,
  type UpdateProfileRequest,
  type UpdateProviderLocationRequest,
  type UpdateProviderProfileRequest,
  type UpdateVehicleRequest,
  type User,
  type Vehicle,
  type VehicleAvailability,
  type VehicleCategory,
  type VehicleHold,
  type VehiclePhoto,
  type VehicleSearchResponse,
  type VehicleStatus,
  type VehicleSummary,
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

export type QueryParams = Record<string, string | number | undefined>;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Multipart upload; the browser sets the content type and boundary. */
  formData?: FormData;
  query?: QueryParams;
  accessToken?: string;
  /** Extra request headers (e.g. `Idempotency-Key`). */
  headers?: Record<string, string>;
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
        ...(opts.headers ?? {}),
      },
      ...(opts.body !== undefined
        ? { body: JSON.stringify(opts.body) }
        : opts.formData
          ? { body: opts.formData }
          : {}),
      credentials: opts.withCredentials ? 'include' : 'same-origin',
      // Uploads of several megabytes need more than the JSON timeout.
      signal: AbortSignal.timeout(opts.formData ? Math.max(timeoutMs, 60_000) : timeoutMs),
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
  /** Maps a 404 to `null` for "do I have one of these?" lookups. */
  const orNull = async <T>(promise: Promise<T>): Promise<T | null> => {
    try {
      return await promise;
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 404) return null;
      throw error;
    }
  };

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

    /** Customer-facing, unauthenticated discovery. */
    public: {
      search: (query: QueryParams): Promise<VehicleSearchResponse> =>
        request('/vehicles/search', VehicleSearchResponseSchema, { query }),
      vehicle: (
        slug: string,
        window: { startsAt?: string; endsAt?: string } = {},
      ): Promise<PublicVehicleDetail> =>
        request(`/vehicles/${encodeURIComponent(slug)}`, PublicVehicleDetailSchema, {
          query: window,
        }),
      suggestPlaces: (q: string, limit = 8): Promise<PlaceSuggestion[]> =>
        request('/places/suggest', z.array(PlaceSuggestionSchema), { query: { q, limit } }),
      /** Price for a window plus a signed quote token when the vehicle is bookable. */
      quote: (slug: string, startsAt: string, endsAt: string): Promise<BookingQuote> =>
        request(`/vehicles/${encodeURIComponent(slug)}/quote`, BookingQuoteSchema, {
          query: { startsAt, endsAt },
        }),
    },

    /** Customer side of bookings (plus the participant-aware detail/contact routes). */
    bookings: {
      /** `idempotencyKey` must be unique per request attempt and reused on retries of the same attempt. */
      create: (
        accessToken: string,
        body: CreateBookingRequest,
        idempotencyKey: string,
      ): Promise<Booking> =>
        request('/bookings', BookingSchema, {
          method: 'POST',
          body,
          accessToken,
          headers: { 'idempotency-key': idempotencyKey },
        }),
      list: (
        accessToken: string,
        query: {
          scope?: BookingScope;
          status?: BookingStatus;
          cursor?: string;
          limit?: number;
        } = {},
      ): Promise<BookingList> => request('/bookings', BookingListSchema, { accessToken, query }),
      get: (accessToken: string, id: string): Promise<Booking> =>
        request(`/bookings/${id}`, BookingSchema, withToken(accessToken)),
      cancel: (accessToken: string, id: string, body: CancelBookingRequest): Promise<Booking> =>
        request(`/bookings/${id}/cancel`, BookingSchema, { method: 'POST', body, accessToken }),
      contact: (accessToken: string, id: string): Promise<BookingContact> =>
        request(`/bookings/${id}/contact`, BookingContactSchema, withToken(accessToken)),
    },

    /** Provider inbox and transitions on bookings of the caller's vehicles. */
    providerBookings: {
      list: (
        accessToken: string,
        query: {
          scope?: BookingScope;
          status?: BookingStatus;
          vehicleId?: string;
          cursor?: string;
          limit?: number;
        } = {},
      ): Promise<BookingList> =>
        request('/providers/me/bookings', BookingListSchema, { accessToken, query }),
      get: (accessToken: string, id: string): Promise<Booking> =>
        request(`/providers/me/bookings/${id}`, BookingSchema, withToken(accessToken)),
      accept: (accessToken: string, id: string, body: AcceptBookingRequest): Promise<Booking> =>
        request(`/providers/me/bookings/${id}/accept`, BookingSchema, {
          method: 'POST',
          body,
          accessToken,
        }),
      decline: (accessToken: string, id: string, body: DeclineBookingRequest): Promise<Booking> =>
        request(`/providers/me/bookings/${id}/decline`, BookingSchema, {
          method: 'POST',
          body,
          accessToken,
        }),
      cancel: (accessToken: string, id: string, body: CancelBookingRequest): Promise<Booking> =>
        request(`/providers/me/bookings/${id}/cancel`, BookingSchema, {
          method: 'POST',
          body,
          accessToken,
        }),
      pickup: (accessToken: string, id: string, body: HandoverRequest): Promise<Booking> =>
        request(`/providers/me/bookings/${id}/pickup`, BookingSchema, {
          method: 'POST',
          body,
          accessToken,
        }),
      complete: (accessToken: string, id: string, body: HandoverRequest): Promise<Booking> =>
        request(`/providers/me/bookings/${id}/return`, BookingSchema, {
          method: 'POST',
          body,
          accessToken,
        }),
      noShow: (accessToken: string, id: string, body: NoShowBookingRequest): Promise<Booking> =>
        request(`/providers/me/bookings/${id}/no-show`, BookingSchema, {
          method: 'POST',
          body,
          accessToken,
        }),
    },

    providers: {
      /** Resolves `null` when the user has not started an application. */
      myApplication: (accessToken: string): Promise<ProviderApplication | null> =>
        orNull(
          request('/providers/me/application', ProviderApplicationSchema, withToken(accessToken)),
        ),
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
      myProfile: (accessToken: string): Promise<ProviderProfile | null> =>
        orNull(request('/providers/me', ProviderProfileSchema, withToken(accessToken))),
      updateProfile: (
        accessToken: string,
        body: UpdateProviderProfileRequest,
      ): Promise<ProviderProfile> =>
        request('/providers/me', ProviderProfileSchema, { method: 'PATCH', body, accessToken }),
    },

    locations: {
      list: (accessToken: string): Promise<ProviderLocation[]> =>
        request('/providers/me/locations', ProviderLocationListSchema, withToken(accessToken)),
      create: (
        accessToken: string,
        body: CreateProviderLocationRequest,
      ): Promise<ProviderLocation> =>
        request('/providers/me/locations', ProviderLocationSchema, {
          method: 'POST',
          body,
          accessToken,
        }),
      update: (
        accessToken: string,
        id: string,
        body: UpdateProviderLocationRequest,
      ): Promise<ProviderLocation> =>
        request(`/providers/me/locations/${id}`, ProviderLocationSchema, {
          method: 'PATCH',
          body,
          accessToken,
        }),
      deactivate: (accessToken: string, id: string): Promise<void> =>
        request(`/providers/me/locations/${id}`, NoContentSchema, {
          method: 'DELETE',
          accessToken,
        }),
    },

    vehicles: {
      list: (accessToken: string): Promise<VehicleSummary[]> =>
        request('/providers/me/vehicles', VehicleListSchema, withToken(accessToken)),
      get: (accessToken: string, id: string): Promise<Vehicle> =>
        request(`/providers/me/vehicles/${id}`, VehicleSchema, withToken(accessToken)),
      create: (accessToken: string, body: CreateVehicleRequest): Promise<Vehicle> =>
        request('/providers/me/vehicles', VehicleSchema, { method: 'POST', body, accessToken }),
      update: (accessToken: string, id: string, body: UpdateVehicleRequest): Promise<Vehicle> =>
        request(`/providers/me/vehicles/${id}`, VehicleSchema, {
          method: 'PATCH',
          body,
          accessToken,
        }),
      submit: (accessToken: string, id: string): Promise<Vehicle> =>
        request(`/providers/me/vehicles/${id}/submit`, VehicleSchema, {
          method: 'POST',
          body: {},
          accessToken,
        }),
      deactivate: (accessToken: string, id: string): Promise<Vehicle> =>
        request(`/providers/me/vehicles/${id}/deactivate`, VehicleSchema, {
          method: 'POST',
          body: {},
          accessToken,
        }),
      activate: (accessToken: string, id: string): Promise<Vehicle> =>
        request(`/providers/me/vehicles/${id}/activate`, VehicleSchema, {
          method: 'POST',
          body: {},
          accessToken,
        }),
      availability: (
        accessToken: string,
        id: string,
        from: string,
        to: string,
      ): Promise<VehicleAvailability> =>
        request(`/providers/me/vehicles/${id}/availability`, VehicleAvailabilitySchema, {
          accessToken,
          query: { from, to },
        }),
      blocks: (
        accessToken: string,
        id: string,
        range: { from?: string; to?: string } = {},
      ): Promise<VehicleHold[]> =>
        request(`/providers/me/vehicles/${id}/blocks`, VehicleHoldListSchema, {
          accessToken,
          query: range,
        }),
      createBlock: (
        accessToken: string,
        id: string,
        body: CreateAvailabilityBlockRequest,
      ): Promise<VehicleHold> =>
        request(`/providers/me/vehicles/${id}/blocks`, VehicleHoldSchema, {
          method: 'POST',
          body,
          accessToken,
        }),
      deleteBlock: (accessToken: string, id: string, blockId: string): Promise<void> =>
        request(`/providers/me/vehicles/${id}/blocks/${blockId}`, NoContentSchema, {
          method: 'DELETE',
          accessToken,
        }),

      listPhotos: (accessToken: string, id: string): Promise<VehiclePhoto[]> =>
        request(
          `/providers/me/vehicles/${id}/photos`,
          VehiclePhotoListSchema,
          withToken(accessToken),
        ),
      uploadPhoto: (accessToken: string, id: string, file: Blob): Promise<VehiclePhoto> => {
        const formData = new FormData();
        formData.append('file', file);
        return request(`/providers/me/vehicles/${id}/photos`, VehiclePhotoSchema, {
          method: 'POST',
          formData,
          accessToken,
        });
      },
      reorderPhotos: (
        accessToken: string,
        id: string,
        photoIds: string[],
      ): Promise<VehiclePhoto[]> =>
        request(`/providers/me/vehicles/${id}/photos/order`, VehiclePhotoListSchema, {
          method: 'PATCH',
          body: { photoIds },
          accessToken,
        }),
      deletePhoto: (accessToken: string, id: string, photoId: string): Promise<void> =>
        request(`/providers/me/vehicles/${id}/photos/${photoId}`, NoContentSchema, {
          method: 'DELETE',
          accessToken,
        }),
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

      listVehicles: (
        accessToken: string,
        query: {
          status?: VehicleStatus;
          providerId?: string;
          cursor?: string;
          limit?: number;
        } = {},
      ): Promise<AdminVehicleList> =>
        request('/admin/vehicles', AdminVehicleListSchema, { accessToken, query }),
      getVehicle: (accessToken: string, id: string): Promise<AdminVehicle> =>
        request(`/admin/vehicles/${id}`, AdminVehicleSchema, withToken(accessToken)),
      vehicleAction: (
        accessToken: string,
        id: string,
        action:
          'start-review' | 'request-changes' | 'approve' | 'reject' | 'suspend' | 'reactivate',
        body: { reason?: string; adminNotes?: string; note?: string } = {},
      ): Promise<AdminVehicle> =>
        request(`/admin/vehicles/${id}/${action}`, AdminVehicleSchema, {
          method: 'POST',
          body: Object.fromEntries(
            Object.entries(body).filter(([, v]) => v !== undefined && v !== ''),
          ),
          accessToken,
        }),

      listBookings: (
        accessToken: string,
        query: {
          status?: BookingStatus;
          providerId?: string;
          customerId?: string;
          reference?: string;
          cursor?: string;
          limit?: number;
        } = {},
      ): Promise<AdminBookingList> =>
        request('/admin/bookings', AdminBookingListSchema, { accessToken, query }),
      getBooking: (accessToken: string, id: string): Promise<AdminBooking> =>
        request(`/admin/bookings/${id}`, AdminBookingSchema, withToken(accessToken)),
      /** Temporary Phase 6 bridge; the API refuses it in production. */
      confirmBookingForTesting: (
        accessToken: string,
        id: string,
        body: ConfirmBookingForTestingRequest,
      ): Promise<AdminBooking> =>
        request(`/admin/bookings/${id}/confirm-for-testing`, AdminBookingSchema, {
          method: 'POST',
          body,
          accessToken,
        }),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
