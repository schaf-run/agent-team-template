import type { components } from './types.ts'

/** RFC 9457 problem details shape, as generated from the contract. */
export type ProblemDetails = components['schemas']['ProblemDetails']

const DEFAULT_BASE_URL = '/api'
const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Thrown for any non-2xx API response. Carries the typed `problem+json`
 * fields so callers can branch on `type` (see `ProblemType` in the
 * contract) instead of parsing message strings.
 */
export class ApiError extends Error {
  readonly type: string
  readonly title: string
  readonly status: number
  readonly detail?: string
  readonly instance?: string

  constructor(problem: ProblemDetails) {
    super(problem.detail ?? problem.title)
    this.name = 'ApiError'
    this.type = problem.type
    this.title = problem.title
    this.status = problem.status
    this.detail = problem.detail
    this.instance = problem.instance
  }
}

/** Thrown when a request is aborted by the per-request timeout (as opposed
 * to an externally supplied `AbortSignal`, which rejects with the
 * platform's own `AbortError` instead). */
export class ApiTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`)
    this.name = 'ApiTimeoutError'
  }
}

export interface ApiFetchOptions {
  method?: string
  headers?: HeadersInit
  body?: BodyInit | null
  /** Caller-driven cancellation, e.g. tied to a component unmount. */
  signal?: AbortSignal
  /** Per-request timeout; defaults to 30s. */
  timeoutMs?: number
  /** Overridable for tests; defaults to the API's OpenAPI `servers` base ("/api"). */
  baseUrl?: string
}

/**
 * Best-effort parse of a non-2xx response body into `ProblemDetails`. Per
 * the contract every error response is `application/problem+json`, but we
 * fall back to a synthesized `ProblemDetails` (using `about:blank` as the
 * generic RFC 9457 `type`) if the body is missing/malformed, so callers can
 * always rely on `ApiError` having well-formed fields.
 */
async function parseProblemDetails(response: Response): Promise<ProblemDetails> {
  try {
    const data: unknown = await response.json()
    if (
      data !== null &&
      typeof data === 'object' &&
      'type' in data &&
      'title' in data &&
      'status' in data
    ) {
      return data as ProblemDetails
    }
  } catch {
    // Body wasn't (valid) JSON at all; fall through to the synthesized value below.
  }
  return {
    type: 'about:blank',
    title: response.statusText || 'Request failed',
    status: response.status,
  }
}

/**
 * Thin fetch wrapper shared by the `api/*` modules (`uploads.ts`,
 * `models.ts`, ...). Resolves with the parsed JSON body typed as `T` on a
 * 2xx response, and throws `ApiError` (parsed from the `problem+json` body)
 * on any non-2xx response.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const {
    method = 'GET',
    headers,
    body,
    signal: externalSignal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    baseUrl = DEFAULT_BASE_URL,
  } = options

  const timeoutController = new AbortController()
  let timedOut = false
  const timeoutId = setTimeout(() => {
    timedOut = true
    timeoutController.abort()
  }, timeoutMs)

  const signal = externalSignal
    ? AbortSignal.any([externalSignal, timeoutController.signal])
    : timeoutController.signal

  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, { method, headers, body, signal })
  } catch (err) {
    if (timedOut) {
      throw new ApiTimeoutError(timeoutMs)
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }

  if (!response.ok) {
    const problem = await parseProblemDetails(response)
    throw new ApiError(problem)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}
