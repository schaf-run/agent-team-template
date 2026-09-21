// Pure TS. No React imports here — see project rule in
// knowledge/docs/3d-model-viewer-plan.md §"Frontend Structure": everything
// under features/viewer/three/ must stay framework-agnostic and
// unit-testable standalone.

import { MeshoptDecoder } from 'meshoptimizer/decoder'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/**
 * Builds a `GLTFLoader` wired up to decode `EXT_meshopt_compression`
 * buffers via the `meshoptimizer` package's WASM `MeshoptDecoder`.
 *
 * The decoder ships its WASM payload inlined as a base64 string inside the
 * JS module (compiled via `WebAssembly.instantiate` at runtime), so this
 * has no dependency on `vite-plugin-wasm`'s `.wasm`-import handling and no
 * dependency on cross-origin-isolation (COOP/COEP) — it is not using
 * `SharedArrayBuffer`/threads, just a single WASM instance.
 */
function buildLoader(): GLTFLoader {
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  return loader
}

let singleton: GLTFLoader | undefined

/**
 * Returns a process-wide singleton `GLTFLoader` with the meshopt decoder
 * wired in. Safe to call repeatedly; the loader (and its worker pool inside
 * `MeshoptDecoder`) is constructed once and reused.
 */
export function createGltfLoader(): GLTFLoader {
  singleton ??= buildLoader()
  return singleton
}
