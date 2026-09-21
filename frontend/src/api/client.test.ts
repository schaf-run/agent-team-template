import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { HttpResponse, delay, http } from 'msw'
import { setupServer } from 'msw/node'
import manifestReady from '../../../contract/fixtures/manifest-ready.json'
import manifestFailed from '../../../contract/fixtures/manifest-failed.json'
import { ApiError, ApiTimeoutError, apiFetch } from './client.ts'
import type { ProblemDetails } from './client.ts'
import type { components } from './types.ts'

type ModelManifest = components['schemas']['ModelManifest']

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('apiFetch', () => {
  it('parses a successful JSON response into the typed shape', async () => {
    server.use(
      http.get('/api/models/:slug', () => HttpResponse.json(manifestReady)),
    )

    const manifest = await apiFetch<ModelManifest>('/models/7Kq2mV9pLx4RtZ0aBcDeFg')

    expect(manifest.slug).toBe(manifestReady.slug)
    expect(manifest.status).toBe('ready')
    expect(manifest.lods).toHaveLength(manifestReady.lods.length)
  })

  it('throws a typed ApiError parsed from a problem+json 4xx body', async () => {
    // Reuse the ProblemDetails embedded in the manifest-failed fixture as
    // the body of a standalone 422 problem+json error response.
    const problem = manifestFailed.error as ProblemDetails

    server.use(
      http.get('/api/models/:slug', () =>
        HttpResponse.json(problem, {
          status: 422,
          headers: { 'Content-Type': 'application/problem+json' },
        }),
      ),
    )

    const rejection = apiFetch('/models/7Kq2mV9pLx4RtZ0aBcDeFg')

    await expect(rejection).rejects.toBeInstanceOf(ApiError)
    await expect(rejection).rejects.toMatchObject({
      type: 'urn:model-viewer:transcode-failed',
      title: 'Model transcoding failed',
      status: 422,
      detail: problem.detail,
    })
  })

  it('throws a typed ApiError parsed from a problem+json 5xx body', async () => {
    const problem: ProblemDetails = {
      type: 'urn:model-viewer:queue-saturated',
      title: 'Transcode queue saturated',
      status: 503,
      detail: 'Try again later.',
    }

    server.use(
      http.post('/api/uploads', () =>
        HttpResponse.json(problem, {
          status: 503,
          headers: { 'Content-Type': 'application/problem+json' },
        }),
      ),
    )

    const rejection = apiFetch('/uploads', { method: 'POST' })

    await expect(rejection).rejects.toBeInstanceOf(ApiError)
    await expect(rejection).rejects.toMatchObject({
      type: 'urn:model-viewer:queue-saturated',
      status: 503,
    })
  })

  it('throws ApiTimeoutError when the request exceeds timeoutMs', async () => {
    server.use(
      http.get('/api/models/:slug', async () => {
        await delay(200)
        return HttpResponse.json(manifestReady)
      }),
    )

    const rejection = apiFetch('/models/7Kq2mV9pLx4RtZ0aBcDeFg', { timeoutMs: 20 })

    await expect(rejection).rejects.toBeInstanceOf(ApiTimeoutError)
  })

  it('rejects with an AbortError when the caller cancels via an external signal', async () => {
    server.use(
      http.get('/api/models/:slug', async () => {
        await delay(200)
        return HttpResponse.json(manifestReady)
      }),
    )

    const controller = new AbortController()
    const rejection = apiFetch('/models/7Kq2mV9pLx4RtZ0aBcDeFg', { signal: controller.signal })
    controller.abort()

    await expect(rejection).rejects.not.toBeInstanceOf(ApiTimeoutError)
    await expect(rejection).rejects.toMatchObject({ name: 'AbortError' })
  })
})
