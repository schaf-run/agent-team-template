import { describe, expect, it } from 'vitest'
import type { Mesh } from 'three'
import { BufferGeometry } from 'three'
import { MeshoptEncoder } from 'meshoptimizer/encoder'
import { createGltfLoader } from './createGltfLoader'

const pad4 = (n: number) => (4 - (n % 4)) % 4

/**
 * Hand-builds a real, spec-shaped GLB (binary glTF 2.0) containing a single
 * triangle whose POSITION and index buffers are compressed with the real
 * `EXT_meshopt_compression` wire format, using the same `meshoptimizer`
 * WASM encoder that the (future) Rust transcode pipeline's `meshopt` crate
 * mirrors on the wire. This exercises the actual decode path, not a mock.
 */
async function buildMeshoptTriangleGlb(): Promise<ArrayBuffer> {
  await MeshoptEncoder.ready

  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
  const indices = new Uint32Array([0, 1, 2])

  const encodedPositions = MeshoptEncoder.encodeGltfBuffer(
    new Uint8Array(positions.buffer),
    3,
    12,
    'ATTRIBUTES',
  )
  const encodedIndices = MeshoptEncoder.encodeGltfBuffer(
    new Uint8Array(indices.buffer),
    3,
    4,
    'TRIANGLES',
  )

  const indicesOffset = encodedPositions.byteLength + pad4(encodedPositions.byteLength)
  const bufferBytes = new Uint8Array(indicesOffset + encodedIndices.byteLength)
  bufferBytes.set(encodedPositions, 0)
  bufferBytes.set(encodedIndices, indicesOffset)

  const json = {
    asset: { version: '2.0' },
    extensionsUsed: ['EXT_meshopt_compression'],
    extensionsRequired: ['EXT_meshopt_compression'],
    buffers: [{ byteLength: bufferBytes.byteLength }],
    bufferViews: [
      {
        buffer: 0,
        byteOffset: 0,
        byteLength: positions.byteLength,
        target: 34962, // ARRAY_BUFFER
        extensions: {
          EXT_meshopt_compression: {
            buffer: 0,
            byteOffset: 0,
            byteLength: encodedPositions.byteLength,
            byteStride: 12,
            count: 3,
            mode: 'ATTRIBUTES',
          },
        },
      },
      {
        buffer: 0,
        byteOffset: 0,
        byteLength: indices.byteLength,
        target: 34963, // ELEMENT_ARRAY_BUFFER
        extensions: {
          EXT_meshopt_compression: {
            buffer: 0,
            byteOffset: indicesOffset,
            byteLength: encodedIndices.byteLength,
            byteStride: 4,
            count: 3,
            mode: 'TRIANGLES',
          },
        },
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126, // FLOAT
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
      {
        bufferView: 1,
        componentType: 5125, // UNSIGNED_INT
        count: 3,
        type: 'SCALAR',
      },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  }

  const jsonBytesRaw = new TextEncoder().encode(JSON.stringify(json))
  const jsonBytes = new Uint8Array(jsonBytesRaw.byteLength + pad4(jsonBytesRaw.byteLength))
  jsonBytes.set(jsonBytesRaw)
  jsonBytes.fill(0x20, jsonBytesRaw.byteLength) // glTF spec: pad JSON chunk with spaces

  const binChunk = new Uint8Array(bufferBytes.byteLength + pad4(bufferBytes.byteLength))
  binChunk.set(bufferBytes) // glTF spec: pad BIN chunk with zeros (Uint8Array default-inits to 0)

  const totalLength = 12 + 8 + jsonBytes.byteLength + 8 + binChunk.byteLength
  const glb = new ArrayBuffer(totalLength)
  const dv = new DataView(glb)
  let offset = 0

  dv.setUint32(offset, 0x46546c67, true) // magic 'glTF'
  offset += 4
  dv.setUint32(offset, 2, true) // version
  offset += 4
  dv.setUint32(offset, totalLength, true)
  offset += 4

  dv.setUint32(offset, jsonBytes.byteLength, true)
  offset += 4
  dv.setUint32(offset, 0x4e4f534a, true) // chunk type 'JSON'
  offset += 4
  new Uint8Array(glb, offset, jsonBytes.byteLength).set(jsonBytes)
  offset += jsonBytes.byteLength

  dv.setUint32(offset, binChunk.byteLength, true)
  offset += 4
  dv.setUint32(offset, 0x004e4942, true) // chunk type 'BIN\0'
  offset += 4
  new Uint8Array(glb, offset, binChunk.byteLength).set(binChunk)
  offset += binChunk.byteLength

  return glb
}

describe('createGltfLoader', () => {
  it('decodes a real EXT_meshopt_compression-compressed GLB via MeshoptDecoder', async () => {
    const glb = await buildMeshoptTriangleGlb()
    const loader = createGltfLoader()

    const gltf = await loader.parseAsync(glb, '')
    const mesh = gltf.scene.children[0] as Mesh
    const geometry = mesh.geometry as BufferGeometry

    expect(geometry.attributes.position.count).toBe(3)
    expect(geometry.index?.count).toBe(3)
    expect(Array.from(geometry.attributes.position.array)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
    expect(Array.from(geometry.index!.array)).toEqual([0, 1, 2])
  })

  it('returns the same loader instance on repeated calls', () => {
    expect(createGltfLoader()).toBe(createGltfLoader())
  })
})
