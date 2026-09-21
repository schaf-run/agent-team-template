import { describe, expect, it } from 'vitest'
import { MAX_UPLOAD_BYTES, validateObj } from './validateObj'

// Mirrors the committed `fixtures/small/cube.obj` baseline sanity fixture
// (a valid triangulated cube with per-face normals). Inlined here rather
// than read from disk so this test has no dependency on Vite/Vitest's
// dev-server file-access allow-list for paths outside the frontend
// workspace root.
const CUBE_OBJ = [
  '# Baseline sanity fixture: a valid triangulated cube with per-face normals.',
  'v -1.0 -1.0 -1.0',
  'v  1.0 -1.0 -1.0',
  'v  1.0  1.0 -1.0',
  'v -1.0  1.0 -1.0',
  'v -1.0 -1.0  1.0',
  'v  1.0 -1.0  1.0',
  'v  1.0  1.0  1.0',
  'v -1.0  1.0  1.0',
  '',
  'vn 0.0 0.0 -1.0',
  'vn 0.0 0.0 1.0',
  'vn 0.0 -1.0 0.0',
  'vn 0.0 1.0 0.0',
  'vn -1.0 0.0 0.0',
  'vn 1.0 0.0 0.0',
  '',
  'f 1//1 2//1 3//1',
  'f 1//1 3//1 4//1',
  'f 5//2 6//2 7//2',
  'f 5//2 7//2 8//2',
  'f 1//3 2//3 6//3',
  'f 1//3 6//3 5//3',
  'f 4//4 3//4 7//4',
  'f 4//4 7//4 8//4',
  'f 1//5 4//5 8//5',
  'f 1//5 8//5 5//5',
  'f 2//6 3//6 7//6',
  'f 2//6 7//6 6//6',
  '',
].join('\n')

/**
 * A `File`-like stand-in that reports a 501 MB size without allocating any
 * actual bytes. `slice()` throws so the test fails loudly if `validateObj`
 * ever tries to read content past the size check.
 */
function fakeOversizedFile(): File {
  return {
    name: 'huge.obj',
    size: 501 * 1024 * 1024,
    slice(): never {
      throw new Error('slice() must not be called for a file rejected by the size check')
    },
  } as unknown as File
}

describe('validateObj', () => {
  it('accepts a valid small .obj fixture', async () => {
    const file = new File([CUBE_OBJ], 'cube.obj', { type: 'text/plain' })

    const result = await validateObj(file)

    expect(result).toEqual({ valid: true, errors: [] })
  })

  it('rejects an .stl file renamed to a .obj extension via the content sniff', async () => {
    const stlContent = [
      'solid cube',
      'facet normal 0 0 -1',
      'outer loop',
      'vertex -1 -1 -1',
      'vertex 1 -1 -1',
      'vertex 1 1 -1',
      'endloop',
      'endfacet',
      'endsolid cube',
      '',
    ].join('\n')
    const file = new File([stlContent], 'model.obj', { type: 'text/plain' })

    const result = await validateObj(file)

    expect(result.valid).toBe(false)
    expect(result.errors[0]).toMatch(/does not look like OBJ content/)
  })

  it('rejects a 501 MB file by size alone, without ever reading its content', async () => {
    const file = fakeOversizedFile()
    expect(file.size).toBeGreaterThan(MAX_UPLOAD_BYTES)

    const result = await validateObj(file)

    expect(result.valid).toBe(false)
    expect(result.errors[0]).toMatch(/too large/)
  })
})
