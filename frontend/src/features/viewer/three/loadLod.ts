// Pure TS. No React imports here — see project rule in
// knowledge/docs/3d-model-viewer-plan.md §"Frontend Structure": everything
// under features/viewer/three/ must stay framework-agnostic and
// unit-testable standalone.

import type { BufferGeometry, Mesh, Object3D } from 'three'
import { createGltfLoader } from './createGltfLoader'

/** Basic facts about a loaded LOD, derived from the parsed geometry and the
 * true number of bytes read off the network (not the `Content-Length`
 * header, which may be absent or unreliable on some transports). */
export interface LodStats {
  /** Triangle count of the loaded mesh. */
  triangleCount: number
  /** Actual bytes consumed from the response stream. */
  byteLength: number
}

export interface LodLoadResult {
  geometry: BufferGeometry
  stats: LodStats
}

/**
 * Called after every chunk read from the network.
 *
 * @param loadedBytes - true cumulative byte count read so far.
 * @param totalBytes - the expected total, parsed from `Content-Length`, or
 *   `undefined` if the response didn't provide one.
 */
export type LodProgressCallback = (loadedBytes: number, totalBytes: number | undefined) => void

export interface LoadLodOptions {
  onProgress?: LodProgressCallback
  /** Aborts both the in-flight `fetch` and the stream read loop. */
  signal?: AbortSignal
}

function abortError(): Error {
  const err = new Error('loadLod aborted')
  err.name = 'AbortError'
  return err
}

/**
 * Races a single `reader.read()` call against `signal` aborting. Whichever
 * settles first resolves/rejects the returned promise; the loser is always
 * given a `.then`/`.catch` so a late resolution/rejection is consumed
 * instead of becoming an unhandled rejection.
 */
function raceReadWithAbort<T>(
  reader: ReadableStreamDefaultReader<T>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<T>> {
  return new Promise((resolve, reject) => {
    let settled = false
    const onAbort = () => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      reject(abortError())
    }
    signal.addEventListener('abort', onAbort)

    reader.read().then(
      (result) => {
        if (!settled) {
          settled = true
          signal.removeEventListener('abort', onAbort)
          resolve(result)
        }
      },
      (err: unknown) => {
        if (!settled) {
          settled = true
          signal.removeEventListener('abort', onAbort)
          reject(err)
        }
      },
    )
  })
}

/**
 * Reads a fetch response body to completion, counting real bytes consumed
 * (never estimated from `Content-Length` alone) and reporting them via
 * `onProgress` after every chunk. Always releases the reader's lock, and
 * cancels it if the read loop exits early (abort or error), leaving no
 * leaked reader lock and no dangling read promise.
 */
async function readBodyWithProgress(
  body: ReadableStream<Uint8Array>,
  totalBytes: number | undefined,
  onProgress: LodProgressCallback | undefined,
  signal: AbortSignal | undefined,
): Promise<ArrayBuffer> {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let loadedBytes = 0
  let exitedEarly = false

  try {
    while (true) {
      if (signal?.aborted) {
        exitedEarly = true
        throw abortError()
      }

      const { done, value } = signal ? await raceReadWithAbort(reader, signal) : await reader.read()
      if (done) break

      chunks.push(value)
      loadedBytes += value.byteLength
      onProgress?.(loadedBytes, totalBytes)
    }
  } catch (err) {
    exitedEarly = true
    throw err
  } finally {
    if (exitedEarly) {
      await reader.cancel().catch(() => {})
    }
    reader.releaseLock()
  }

  const combined = new Uint8Array(loadedBytes)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return combined.buffer
}

function parseContentLength(response: Response): number | undefined {
  const raw = response.headers.get('content-length')
  if (raw === null) return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

function findFirstMesh(root: Object3D): Mesh | undefined {
  let found: Mesh | undefined
  root.traverse((obj) => {
    if (!found && (obj as Mesh).isMesh) {
      found = obj as Mesh
    }
  })
  return found
}

/**
 * Downloads a LOD GLB, reporting true byte-counted download progress, then
 * parses it via the shared `createGltfLoader()` singleton (F4-1). Returns
 * the first mesh's geometry plus basic stats. Abortable: passing `signal`
 * cancels both the `fetch` and the in-flight stream read cleanly.
 */
export async function loadLod(url: string, options: LoadLodOptions = {}): Promise<LodLoadResult> {
  const { onProgress, signal } = options

  const response = await fetch(url, { signal })
  if (!response.ok) {
    throw new Error(`loadLod: fetch failed for ${url} with status ${response.status}`)
  }
  if (!response.body) {
    throw new Error(`loadLod: response for ${url} has no body`)
  }

  const totalBytes = parseContentLength(response)
  const arrayBuffer = await readBodyWithProgress(response.body, totalBytes, onProgress, signal)

  const loader = createGltfLoader()
  const gltf = await loader.parseAsync(arrayBuffer, '')

  const mesh = findFirstMesh(gltf.scene)
  if (!mesh) {
    throw new Error(`loadLod: parsed GLB from ${url} contains no mesh`)
  }
  const geometry = mesh.geometry as BufferGeometry

  const triangleCount = geometry.index
    ? geometry.index.count / 3
    : (geometry.attributes.position?.count ?? 0) / 3

  return {
    geometry,
    stats: {
      triangleCount,
      byteLength: arrayBuffer.byteLength,
    },
  }
}
