import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, Uint16BufferAttribute } from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { loadLod } from './loadLod'

// B2-8 (the real transcode pipeline producing GLB fixtures) doesn't exist
// yet, so these tests mock the fetch/parseAsync boundary rather than
// exercising a real GLB. `createGltfLoader.test.ts` already covers the
// real meshopt decode path end to end.
const parseAsync = vi.fn<(data: ArrayBuffer | string, path: string) => Promise<GLTF>>()

vi.mock('./createGltfLoader', () => ({
  createGltfLoader: () => ({ parseAsync }),
}))

function fakeGltf(): GLTF {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3))
  geometry.setIndex(new Uint16BufferAttribute(new Uint16Array([0, 1, 2]), 1))
  const mesh = new Mesh(geometry, new MeshBasicMaterial())
  const scene = new Group()
  scene.add(mesh)
  return {
    scene,
    scenes: [scene],
    cameras: [],
    animations: [],
    asset: {},
    parser: {} as GLTF['parser'],
    userData: {},
  }
}

/** Builds a `Response` whose body is a `ReadableStream` that enqueues the
 * given chunks one at a time, so tests can assert on true byte-counted
 * progress rather than an estimate. */
function streamedResponse(chunks: Uint8Array[], contentLength?: number): Response {
  let i = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i])
        i += 1
      } else {
        controller.close()
      }
    },
  })
  const headers = new Headers()
  if (contentLength !== undefined) headers.set('content-length', String(contentLength))
  return new Response(stream, { status: 200, headers })
}

/** A body stream that emits one chunk, then stalls forever on the second
 * (never resolving `pull`), so abort-mid-download can be tested
 * deterministically. */
function stallingResponse() {
  let cancelled = false
  const firstChunk = new Uint8Array([1, 2, 3, 4])
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(firstChunk)
    },
    pull() {
      return new Promise<void>(() => {
        // Deliberately never resolves — simulates a stalled network read
        // so the test can abort while a chunk read is in flight.
      })
    },
    cancel() {
      cancelled = true
    },
  })
  const response = new Response(stream, { status: 200 })
  return {
    response,
    isCancelled: () => cancelled,
  }
}

describe('loadLod', () => {
  beforeEach(() => {
    parseAsync.mockReset()
    parseAsync.mockResolvedValue(fakeGltf())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports true byte-counted progress and returns geometry + stats', async () => {
    const chunkSizes = [1000, 2500, 1500]
    const chunks = chunkSizes.map((size) => new Uint8Array(size).fill(7))
    const totalBytes = chunkSizes.reduce((a, b) => a + b, 0)

    const fetchMock = vi.fn(async () => streamedResponse(chunks, totalBytes))
    vi.stubGlobal('fetch', fetchMock)

    const progressCalls: Array<[number, number | undefined]> = []
    const result = await loadLod('https://example.test/lod0.glb', {
      onProgress: (loaded, total) => progressCalls.push([loaded, total]),
    })

    // Real, cumulative byte counts — not estimated, not just the final total.
    expect(progressCalls).toEqual([
      [1000, totalBytes],
      [3500, totalBytes],
      [5000, totalBytes],
    ])

    expect(parseAsync).toHaveBeenCalledTimes(1)
    const [arrayBuffer] = parseAsync.mock.calls[0]
    expect((arrayBuffer as ArrayBuffer).byteLength).toBe(totalBytes)

    expect(result.geometry).toBeInstanceOf(BufferGeometry)
    expect(result.stats).toEqual({ triangleCount: 1, byteLength: totalBytes })
  })

  it('reports progress even without a Content-Length header', async () => {
    const chunks = [new Uint8Array(10), new Uint8Array(20)]
    const fetchMock = vi.fn(async () => streamedResponse(chunks))
    vi.stubGlobal('fetch', fetchMock)

    const progressCalls: Array<[number, number | undefined]> = []
    await loadLod('https://example.test/lod0.glb', {
      onProgress: (loaded, total) => progressCalls.push([loaded, total]),
    })

    expect(progressCalls).toEqual([
      [10, undefined],
      [30, undefined],
    ])
  })

  it('aborts mid-download cleanly: cancels the reader/stream and leaves no unhandled rejection', async () => {
    const { response, isCancelled } = stallingResponse()
    const fetchMock = vi.fn(async () => response)
    vi.stubGlobal('fetch', fetchMock)

    const controller = new AbortController()
    const progressCalls: number[] = []

    const loadPromise = loadLod('https://example.test/lod0.glb', {
      signal: controller.signal,
      onProgress: (loaded) => progressCalls.push(loaded),
    })

    // Let the first chunk be read and reported before aborting mid-stream,
    // while the second chunk is still stalled in `pull`.
    await vi.waitFor(() => expect(progressCalls).toEqual([4]))

    controller.abort()

    await expect(loadPromise).rejects.toMatchObject({ name: 'AbortError' })
    expect(parseAsync).not.toHaveBeenCalled()
    expect(isCancelled()).toBe(true)
  })

  it('never calls fetch at all if already aborted before the call', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => {
      if (init?.signal?.aborted) {
        const err = new Error('aborted')
        err.name = 'AbortError'
        throw err
      }
      return streamedResponse([new Uint8Array(1)])
    })
    vi.stubGlobal('fetch', fetchMock)

    const controller = new AbortController()
    controller.abort()

    await expect(loadLod('https://example.test/lod0.glb', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(parseAsync).not.toHaveBeenCalled()
  })

  it('throws a clear error when the parsed GLB has no mesh', async () => {
    parseAsync.mockResolvedValue({
      scene: new Group(),
      scenes: [],
      cameras: [],
      animations: [],
      asset: {},
      parser: {} as GLTF['parser'],
      userData: {},
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamedResponse([new Uint8Array(4)])),
    )

    await expect(loadLod('https://example.test/lod0.glb')).rejects.toThrow(/contains no mesh/)
  })
})
