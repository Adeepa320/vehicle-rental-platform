/** URI version segment used by the API (`/api/v1`). Additive changes only within a version. */
export const API_VERSION = '1' as const;

/** Global route prefix in front of the version segment. */
export const API_GLOBAL_PREFIX = 'api' as const;

/** Base path every v1 endpoint is mounted under, e.g. `http://localhost:4000/api/v1`. */
export const API_BASE_PATH = `/${API_GLOBAL_PREFIX}/v${API_VERSION}` as const;
