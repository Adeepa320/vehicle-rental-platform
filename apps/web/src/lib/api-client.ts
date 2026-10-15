import {
  AdminBookingListSchema,
  AdminBookingSchema,
  AdminDisputeListSchema,
  AdminDisputeSchema,
  AdminDistrictSchema,
  AdminDocumentListSchema,
  AdminDocumentSchema,
  AdminOverviewSchema,
  AdminPlaceSchema,
  AdminSettingsResponseSchema,
  AdminUserDetailSchema,
  AdminUserListSchema,
  AdminVehicleCategorySchema,
  AuditEventListSchema,
  BookingDisputeStateSchema,
  CancellationPreviewSchema,
  DisputeSchema,
  ProviderDocumentListSchema,
  ProviderDocumentSchema,
  ProviderReportSchema,
  ReportsOverviewSchema,
  ResendNotificationResponseSchema,
  AdminPaymentListItemSchema,
  AdminPaymentListSchema,
  AdminReviewListSchema,
  AdminReviewSchema,
  BookingReviewStateSchema,
  CustomerReviewSchema,
  ExchangeRatesResponseSchema,
  MarkAllReadResponseSchema,
  NotificationListSchema,
  NotificationSchema,
  ProviderMetricsSchema,
  ProviderReviewListSchema,
  ProviderReviewSchema,
  PublicReviewListSchema,
  UnreadCountSchema,
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
  CheckoutSessionSchema,
  PaymentListSchema,
  PaymentReconciliationSchema,
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
  type AdminCancelBookingRequest,
  type AdminCancellationActor,
  type AdminDispute,
  type AdminDisputeList,
  type AdminDistrict,
  type AdminDocument,
  type AdminDocumentList,
  type AdminOverview,
  type AdminPlace,
  type AdminSettingsResponse,
  type AdminUserDetail,
  type AdminUserList,
  type AdminVehicleCategory,
  type AnonymiseUserRequest,
  type ApproveDocumentRequest,
  type AuditEventList,
  type BookingDisputeState,
  type CancellationPreview,
  type CorrectVehicleCategoryRequest,
  type CreatePlaceRequest,
  type DisputeInternalNoteRequest,
  type DisputeMessageRequest,
  type DisputeStatus,
  type Dispute,
  type DocumentEffectiveStatus,
  type DocumentScope,
  type OpenDisputeRequest,
  type ProviderDocument,
  type ProviderDocumentList,
  type ProviderReport,
  type ReactivateUserRequest,
  type RejectDisputeRequest,
  type RejectDocumentRequest,
  type RemoveVehiclePhotoRequest,
  type ReportCsvName,
  type ReportQuery,
  type ReportsOverview,
  type RequestDocumentReplacementRequest,
  type ResendNotificationResponse,
  type ResendTemplate,
  type ResolveDisputeRequest,
  type StartDisputeReviewRequest,
  type SuspendUserRequest,
  type UpdateDistrictRequest,
  type UpdatePlaceRequest,
  type UpdateSettingsRequest,
  type UpdateVehicleCategoryRequest,
  type UploadDocumentFields,
  type UserRole,
  type UserStatus,
  type AdminPaymentList,
  type AdminPaymentListItem,
  type AdminReview,
  type AdminReviewList,
  type BookingReviewState,
  type CreateReviewRequest,
  type CustomerReview,
  type ExchangeRatesResponse,
  type HideReviewRequest,
  type MarkAllReadResponse,
  type Notification,
  type NotificationList,
  type ProviderMetrics,
  type ProviderReview,
  type ProviderReviewList,
  type PublicReviewList,
  type ReplyReviewRequest,
  type UnhideReviewRequest,
  type UnreadCount,
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
  type CheckoutSession,
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
  type PaymentList,
  type PaymentReconciliation,
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
  type RecordRefundRequest,
  type RegisterRequest,
  type RegisterResponse,
  type ResolvePaymentRequest,
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

  function buildUrl(path: string, query: QueryParams | undefined): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const queryString = params.toString();
    return `${baseUrl}${path}${queryString ? `?${queryString}` : ''}`;
  }

  /** The API error envelope as a typed error, or a generic one when the body is not ours. */
  function errorFor(path: string, status: number, body: unknown): ApiClientError {
    const parsed = ApiErrorSchema.safeParse(body);
    if (parsed.success) {
      const { code, message, requestId, details } = parsed.data.error;
      return new ApiClientError(status, code, message, requestId, details);
    }
    return new ApiClientError(
      status,
      'INTERNAL',
      `Request to ${path} failed with status ${status}`,
    );
  }

  /**
   * Authenticated binary download (private documents, CSV exports). The caller
   * turns the Blob into an object URL; nothing here is ever a shareable link.
   */
  async function fetchBlob(path: string, accessToken: string, query?: QueryParams): Promise<Blob> {
    const response = await fetchImpl(buildUrl(path, query), {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
      credentials: 'same-origin',
      signal: AbortSignal.timeout(Math.max(timeoutMs, 60_000)),
      cache: 'no-store',
    });
    if (!response.ok) {
      throw errorFor(path, response.status, await response.json().catch(() => undefined));
    }
    return response.blob();
  }

  async function request<T>(
    path: string,
    schema: ZodType<T>,
    opts: RequestOptions = {},
  ): Promise<T> {
    const response = await fetchImpl(buildUrl(path, opts.query), {
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
      throw errorFor(path, response.status, body);
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
    /** Authenticated binary download; see `fetchBlob` above. */
    fetchBlob,
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
      /** Indicative LKR → foreign display rates (operator-maintained; never used for pricing). */
      exchangeRates: (): Promise<ExchangeRatesResponse> =>
        request('/reference/exchange-rates', ExchangeRatesResponseSchema),
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
      /** Published reviews of a listed vehicle, newest first. */
      vehicleReviews: (
        slug: string,
        query: { cursor?: string; limit?: number } = {},
      ): Promise<PublicReviewList> =>
        request(`/vehicles/${encodeURIComponent(slug)}/reviews`, PublicReviewListSchema, {
          query,
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
      /** Starts (or resumes) the online advance: the amount comes from the booking, never from here. */
      createCheckout: (accessToken: string, id: string): Promise<CheckoutSession> =>
        request(`/bookings/${id}/payments/checkout`, CheckoutSessionSchema, {
          method: 'POST',
          body: {},
          accessToken,
        }),
      payments: (accessToken: string, id: string): Promise<PaymentList> =>
        request(`/bookings/${id}/payments`, PaymentListSchema, withToken(accessToken)),
      /** Review eligibility and my existing review for a completed booking. */
      reviewState: (accessToken: string, id: string): Promise<BookingReviewState> =>
        request(`/bookings/${id}/review`, BookingReviewStateSchema, withToken(accessToken)),
      createReview: (
        accessToken: string,
        id: string,
        body: CreateReviewRequest,
      ): Promise<CustomerReview> =>
        request(`/bookings/${id}/review`, CustomerReviewSchema, {
          method: 'POST',
          body,
          accessToken,
        }),
      updateReview: (
        accessToken: string,
        id: string,
        body: CreateReviewRequest,
      ): Promise<CustomerReview> =>
        request(`/bookings/${id}/review`, CustomerReviewSchema, {
          method: 'PUT',
          body,
          accessToken,
        }),
    },

    /** The caller's in-app notification feed. */
    notifications: {
      list: (
        accessToken: string,
        query: { cursor?: string; limit?: number; unreadOnly?: boolean } = {},
      ): Promise<NotificationList> =>
        request('/notifications', NotificationListSchema, {
          accessToken,
          query: {
            cursor: query.cursor,
            limit: query.limit,
            unreadOnly: query.unreadOnly === undefined ? undefined : String(query.unreadOnly),
          },
        }),
      unreadCount: (accessToken: string): Promise<UnreadCount> =>
        request('/notifications/unread-count', UnreadCountSchema, withToken(accessToken)),
      markRead: (accessToken: string, id: string): Promise<Notification> =>
        request(`/notifications/${id}/read`, NotificationSchema, {
          method: 'POST',
          body: {},
          accessToken,
        }),
      markAllRead: (accessToken: string): Promise<MarkAllReadResponse> =>
        request('/notifications/read-all', MarkAllReadResponseSchema, {
          method: 'POST',
          body: {},
          accessToken,
        }),
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
      /** Trust metrics from booking history (safe aggregates only). */
      metrics: (accessToken: string): Promise<ProviderMetrics> =>
        request('/providers/me/metrics', ProviderMetricsSchema, withToken(accessToken)),
    },

    /** Participant side of disputes (the customer or the provider of the booking). */
    disputes: {
      /** Eligibility plus the existing dispute, if any. */
      bookingState: (accessToken: string, bookingId: string): Promise<BookingDisputeState> =>
        request(
          `/bookings/${bookingId}/dispute`,
          BookingDisputeStateSchema,
          withToken(accessToken),
        ),
      open: (accessToken: string, bookingId: string, body: OpenDisputeRequest): Promise<Dispute> =>
        request(`/bookings/${bookingId}/dispute`, DisputeSchema, {
          method: 'POST',
          body,
          accessToken,
        }),
      get: (accessToken: string, id: string): Promise<Dispute> =>
        request(`/disputes/${id}`, DisputeSchema, withToken(accessToken)),
      message: (accessToken: string, id: string, body: DisputeMessageRequest): Promise<Dispute> =>
        request(`/disputes/${id}/messages`, DisputeSchema, { method: 'POST', body, accessToken }),
    },

    /** Private verification documents of the caller's provider profile and vehicles. */
    providerDocuments: {
      list: (
        accessToken: string,
        query: { vehicleId?: string; includeHistory?: boolean } = {},
      ): Promise<ProviderDocumentList> =>
        request('/providers/me/documents', ProviderDocumentListSchema, {
          accessToken,
          query: {
            vehicleId: query.vehicleId,
            includeHistory:
              query.includeHistory === undefined ? undefined : String(query.includeHistory),
          },
        }),
      /** Multipart upload; the bytes are sniffed server-side, so the declared type is irrelevant. */
      upload: (
        accessToken: string,
        file: File,
        fields: UploadDocumentFields,
      ): Promise<ProviderDocument> => {
        const formData = new FormData();
        formData.append('file', file, file.name);
        for (const [key, value] of Object.entries(fields)) {
          if (value !== undefined && value !== '') formData.append(key, String(value));
        }
        return request('/providers/me/documents', ProviderDocumentSchema, {
          method: 'POST',
          formData,
          accessToken,
        });
      },
      /** The file itself, streamed with the bearer token (never a shareable URL). */
      content: (accessToken: string, id: string): Promise<Blob> =>
        fetchBlob(`/providers/me/documents/${id}/content`, accessToken),
    },

    /** Reviews of the caller's own vehicles and the one-time reply. */
    providerReviews: {
      list: (
        accessToken: string,
        query: { cursor?: string; limit?: number } = {},
      ): Promise<ProviderReviewList> =>
        request('/providers/me/reviews', ProviderReviewListSchema, { accessToken, query }),
      reply: (accessToken: string, id: string, body: ReplyReviewRequest): Promise<ProviderReview> =>
        request(`/providers/me/reviews/${id}/reply`, ProviderReviewSchema, {
          method: 'POST',
          body,
          accessToken,
        }),
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
      /** Operations home: counts of things that need a human, each with its queue path. */
      overview: (accessToken: string): Promise<AdminOverview> =>
        request('/admin/overview', AdminOverviewSchema, withToken(accessToken)),

      /** User management (safe projections only; never auth-table data). */
      listUsers: (
        accessToken: string,
        query: {
          q?: string;
          status?: UserStatus;
          role?: UserRole;
          createdFrom?: string;
          createdTo?: string;
          cursor?: string;
          limit?: number;
        } = {},
      ): Promise<AdminUserList> =>
        request('/admin/users', AdminUserListSchema, { accessToken, query }),
      getUser: (accessToken: string, id: string): Promise<AdminUserDetail> =>
        request(`/admin/users/${id}`, AdminUserDetailSchema, withToken(accessToken)),
      suspendUser: (
        accessToken: string,
        id: string,
        body: SuspendUserRequest,
      ): Promise<AdminUserDetail> =>
        request(`/admin/users/${id}/suspend`, AdminUserDetailSchema, {
          method: 'POST',
          body,
          accessToken,
        }),
      reactivateUser: (
        accessToken: string,
        id: string,
        body: ReactivateUserRequest = {},
      ): Promise<AdminUserDetail> =>
        request(`/admin/users/${id}/reactivate`, AdminUserDetailSchema, {
          method: 'POST',
          body,
          accessToken,
        }),
      /** Irreversible; the API refuses it with `ACCOUNT_ANONYMISATION_BLOCKED` while blockers exist. */
      anonymiseUser: (
        accessToken: string,
        id: string,
        body: AnonymiseUserRequest,
      ): Promise<AdminUserDetail> =>
        request(`/admin/users/${id}/anonymise`, AdminUserDetailSchema, {
          method: 'POST',
          body,
          accessToken,
        }),

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
        query: { status?: ProviderStatus; q?: string; cursor?: string; limit?: number } = {},
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
          categoryId?: string;
          placeId?: string;
          q?: string;
          cursor?: string;
          limit?: number;
        } = {},
      ): Promise<AdminVehicleList> =>
        request('/admin/vehicles', AdminVehicleListSchema, { accessToken, query }),
      getVehicle: (accessToken: string, id: string): Promise<AdminVehicle> =>
        request(`/admin/vehicles/${id}`, AdminVehicleSchema, withToken(accessToken)),
      /** Moves a listing to another existing, active category (audited). */
      correctVehicleCategory: (
        accessToken: string,
        id: string,
        body: CorrectVehicleCategoryRequest,
      ): Promise<AdminVehicle> =>
        request(`/admin/vehicles/${id}/category`, AdminVehicleSchema, {
          method: 'POST',
          body,
          accessToken,
        }),
      removeVehiclePhoto: (
        accessToken: string,
        id: string,
        photoId: string,
        body: RemoveVehiclePhotoRequest,
      ): Promise<AdminVehicle> =>
        request(`/admin/vehicles/${id}/photos/${photoId}/remove`, AdminVehicleSchema, {
          method: 'POST',
          body,
          accessToken,
        }),
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
          vehicleId?: string;
          reference?: string;
          q?: string;
          from?: string;
          to?: string;
          cursor?: string;
          limit?: number;
        } = {},
      ): Promise<AdminBookingList> =>
        request('/admin/bookings', AdminBookingListSchema, { accessToken, query }),
      getBooking: (accessToken: string, id: string): Promise<AdminBooking> =>
        request(`/admin/bookings/${id}`, AdminBookingSchema, withToken(accessToken)),
      /** What an admin cancellation on behalf of `actor` would do, without doing it. */
      cancellationPreview: (
        accessToken: string,
        id: string,
        actor: AdminCancellationActor,
      ): Promise<CancellationPreview> =>
        request(`/admin/bookings/${id}/cancellation-preview`, CancellationPreviewSchema, {
          accessToken,
          query: { actor },
        }),
      cancelBooking: (
        accessToken: string,
        id: string,
        body: AdminCancelBookingRequest,
      ): Promise<AdminBooking> =>
        request(`/admin/bookings/${id}/cancel`, AdminBookingSchema, {
          method: 'POST',
          body,
          accessToken,
        }),
      /** Sends one of the booking's transactional e-mails again (recipient and wording are server-side). */
      resendNotification: (
        accessToken: string,
        id: string,
        template: ResendTemplate,
      ): Promise<ResendNotificationResponse> =>
        request(`/admin/bookings/${id}/resend`, ResendNotificationResponseSchema, {
          method: 'POST',
          body: { template },
          accessToken,
        }),

      /** Payments flagged for manual resolution. */
      listPayments: (
        accessToken: string,
        query: { limit?: number } = {},
      ): Promise<AdminPaymentList> =>
        request('/admin/payments', AdminPaymentListSchema, { accessToken, query }),
      getPayment: (accessToken: string, id: string): Promise<AdminPaymentListItem> =>
        request(`/admin/payments/${id}`, AdminPaymentListItemSchema, withToken(accessToken)),
      recordRefund: (
        accessToken: string,
        id: string,
        body: RecordRefundRequest,
      ): Promise<AdminPaymentListItem> =>
        request(`/admin/payments/${id}/refund`, AdminPaymentListItemSchema, {
          method: 'POST',
          body,
          accessToken,
        }),
      resolvePayment: (
        accessToken: string,
        id: string,
        body: ResolvePaymentRequest,
      ): Promise<AdminPaymentListItem> =>
        request(`/admin/payments/${id}/resolve`, AdminPaymentListItemSchema, {
          method: 'POST',
          body,
          accessToken,
        }),
      reconcilePayment: (accessToken: string, id: string): Promise<PaymentReconciliation> =>
        request(`/admin/payments/${id}/reconcile`, PaymentReconciliationSchema, {
          method: 'POST',
          body: {},
          accessToken,
        }),

      /** Review moderation. */
      listReviews: (
        accessToken: string,
        query: { status?: 'published' | 'hidden'; cursor?: string; limit?: number } = {},
      ): Promise<AdminReviewList> =>
        request('/admin/reviews', AdminReviewListSchema, { accessToken, query }),
      getReview: (accessToken: string, id: string): Promise<AdminReview> =>
        request(`/admin/reviews/${id}`, AdminReviewSchema, withToken(accessToken)),
      hideReview: (
        accessToken: string,
        id: string,
        body: HideReviewRequest,
      ): Promise<AdminReview> =>
        request(`/admin/reviews/${id}/hide`, AdminReviewSchema, {
          method: 'POST',
          body,
          accessToken,
        }),
      unhideReview: (
        accessToken: string,
        id: string,
        body: UnhideReviewRequest,
      ): Promise<AdminReview> =>
        request(`/admin/reviews/${id}/unhide`, AdminReviewSchema, {
          method: 'POST',
          body,
          accessToken,
        }),

      /** Document verification queue. */
      listDocuments: (
        accessToken: string,
        query: {
          status?: DocumentEffectiveStatus;
          scope?: DocumentScope;
          providerId?: string;
          vehicleId?: string;
          expiringWithinDays?: number;
          cursor?: string;
          limit?: number;
        } = {},
      ): Promise<AdminDocumentList> =>
        request('/admin/documents', AdminDocumentListSchema, { accessToken, query }),
      getDocument: (accessToken: string, id: string): Promise<AdminDocument> =>
        request(`/admin/documents/${id}`, AdminDocumentSchema, withToken(accessToken)),
      /** The file itself (audited server-side); open it from a Blob URL, never a plain link. */
      documentContent: (accessToken: string, id: string): Promise<Blob> =>
        fetchBlob(`/admin/documents/${id}/content`, accessToken),
      approveDocument: (
        accessToken: string,
        id: string,
        body: ApproveDocumentRequest = {},
      ): Promise<AdminDocument> =>
        request(`/admin/documents/${id}/approve`, AdminDocumentSchema, {
          method: 'POST',
          body,
          accessToken,
        }),
      rejectDocument: (
        accessToken: string,
        id: string,
        body: RejectDocumentRequest,
      ): Promise<AdminDocument> =>
        request(`/admin/documents/${id}/reject`, AdminDocumentSchema, {
          method: 'POST',
          body,
          accessToken,
        }),
      requestDocumentReplacement: (
        accessToken: string,
        id: string,
        body: RequestDocumentReplacementRequest,
      ): Promise<AdminDocument> =>
        request(`/admin/documents/${id}/request-replacement`, AdminDocumentSchema, {
          method: 'POST',
          body,
          accessToken,
        }),

      /** Dispute handling. Nothing here moves money. */
      listDisputes: (
        accessToken: string,
        query: { status?: DisputeStatus; bookingId?: string; cursor?: string; limit?: number } = {},
      ): Promise<AdminDisputeList> =>
        request('/admin/disputes', AdminDisputeListSchema, { accessToken, query }),
      getDispute: (accessToken: string, id: string): Promise<AdminDispute> =>
        request(`/admin/disputes/${id}`, AdminDisputeSchema, withToken(accessToken)),
      startDisputeReview: (
        accessToken: string,
        id: string,
        body: StartDisputeReviewRequest = {},
      ): Promise<AdminDispute> =>
        request(`/admin/disputes/${id}/start-review`, AdminDisputeSchema, {
          method: 'POST',
          body,
          accessToken,
        }),
      /** Public message to both participants. */
      postDisputeMessage: (
        accessToken: string,
        id: string,
        body: DisputeMessageRequest,
      ): Promise<AdminDispute> =>
        request(`/admin/disputes/${id}/messages`, AdminDisputeSchema, {
          method: 'POST',
          body,
          accessToken,
        }),
      /** Internal note: never shown to participants. */
      setDisputeInternalNote: (
        accessToken: string,
        id: string,
        body: DisputeInternalNoteRequest,
      ): Promise<AdminDispute> =>
        request(`/admin/disputes/${id}/internal-note`, AdminDisputeSchema, {
          method: 'PUT',
          body,
          accessToken,
        }),
      resolveDispute: (
        accessToken: string,
        id: string,
        body: ResolveDisputeRequest,
      ): Promise<AdminDispute> =>
        request(`/admin/disputes/${id}/resolve`, AdminDisputeSchema, {
          method: 'POST',
          body,
          accessToken,
        }),
      rejectDispute: (
        accessToken: string,
        id: string,
        body: RejectDisputeRequest,
      ): Promise<AdminDispute> =>
        request(`/admin/disputes/${id}/reject`, AdminDisputeSchema, {
          method: 'POST',
          body,
          accessToken,
        }),

      /** Typed platform settings (read: admin; write: super admin). */
      getSettings: (accessToken: string): Promise<AdminSettingsResponse> =>
        request('/admin/settings', AdminSettingsResponseSchema, withToken(accessToken)),
      updateSettings: (
        accessToken: string,
        body: UpdateSettingsRequest,
      ): Promise<AdminSettingsResponse> =>
        request('/admin/settings', AdminSettingsResponseSchema, {
          method: 'PUT',
          body,
          accessToken,
        }),

      /** Reference data (writes: super admin; nothing is ever hard deleted). */
      listDistricts: (accessToken: string): Promise<AdminDistrict[]> =>
        request('/admin/districts', z.array(AdminDistrictSchema), withToken(accessToken)),
      updateDistrict: (
        accessToken: string,
        id: string,
        body: UpdateDistrictRequest,
      ): Promise<AdminDistrict> =>
        request(`/admin/districts/${id}`, AdminDistrictSchema, {
          method: 'PATCH',
          body,
          accessToken,
        }),
      listPlaces: (
        accessToken: string,
        query: { districtId?: string; q?: string; includeInactive?: boolean } = {},
      ): Promise<AdminPlace[]> =>
        request('/admin/places', z.array(AdminPlaceSchema), {
          accessToken,
          query: {
            districtId: query.districtId,
            q: query.q,
            includeInactive:
              query.includeInactive === undefined ? undefined : String(query.includeInactive),
          },
        }),
      createPlace: (accessToken: string, body: CreatePlaceRequest): Promise<AdminPlace> =>
        request('/admin/places', AdminPlaceSchema, { method: 'POST', body, accessToken }),
      updatePlace: (
        accessToken: string,
        id: string,
        body: UpdatePlaceRequest,
      ): Promise<AdminPlace> =>
        request(`/admin/places/${id}`, AdminPlaceSchema, { method: 'PATCH', body, accessToken }),
      listVehicleCategories: (accessToken: string): Promise<AdminVehicleCategory[]> =>
        request(
          '/admin/vehicle-categories',
          z.array(AdminVehicleCategorySchema),
          withToken(accessToken),
        ),
      updateVehicleCategory: (
        accessToken: string,
        id: string,
        body: UpdateVehicleCategoryRequest,
      ): Promise<AdminVehicleCategory> =>
        request(`/admin/vehicle-categories/${id}`, AdminVehicleCategorySchema, {
          method: 'PATCH',
          body,
          accessToken,
        }),

      /** Read-only audit trail. */
      listAuditEvents: (
        accessToken: string,
        query: {
          actorUserId?: string;
          action?: string;
          targetType?: string;
          targetId?: string;
          from?: string;
          to?: string;
          cursor?: string;
          limit?: number;
        } = {},
      ): Promise<AuditEventList> =>
        request('/admin/audit-events', AuditEventListSchema, { accessToken, query }),

      /** Operational reports computed on read; CSVs are the only exports. */
      reportsOverview: (accessToken: string, query: ReportQuery): Promise<ReportsOverview> =>
        request('/admin/reports/overview', ReportsOverviewSchema, { accessToken, query }),
      reportsProviders: (accessToken: string): Promise<ProviderReport> =>
        request('/admin/reports/providers', ProviderReportSchema, withToken(accessToken)),
      reportCsv: (accessToken: string, name: ReportCsvName, query?: ReportQuery): Promise<Blob> =>
        fetchBlob(`/admin/reports/${name}.csv`, accessToken, query),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
