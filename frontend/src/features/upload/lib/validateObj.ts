// Pure TS. No React imports here — this runs as a client-side pre-flight
// check before uploading a potentially 500 MB file (see
// knowledge/docs/3d-model-viewer-plan.md §3.2, §6.5 F3-2). It must fail
// fast: the size check is done against `File.size` alone, and the content
// sniff only ever reads the first 64 KB, so a huge file is rejected
// without ever touching its bytes.

/**
 * Maximum accepted size of an original `.obj` upload, in bytes (500 MB).
 * Mirrors `MAX_UPLOAD_BYTES` in `backend/crates/model-core/src/limits.rs`;
 * keep the two in sync if the limit ever changes.
 */
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024

/** Number of bytes read from the head of the file for the content sniff. */
const SNIFF_BYTES = 64 * 1024

const OBJ_EXTENSION_PATTERN = /\.obj$/i
const VERTEX_LINE_PATTERN = /^v\s/m
const FACE_LINE_PATTERN = /^f\s/m

export interface ValidateObjResult {
  valid: boolean
  errors: string[]
}

/**
 * Reads the first `SNIFF_BYTES` of `file` and decodes it as UTF-8 (lossy —
 * malformed bytes just fail the content check rather than throwing).
 */
async function readHead(file: File): Promise<string> {
  const head = await file.slice(0, SNIFF_BYTES).arrayBuffer()
  return new TextDecoder('utf-8', { fatal: false }).decode(head)
}

/**
 * Pre-flight validation for a file the user picked to upload as an `.obj`
 * model. Checks are ordered cheapest-and-most-decisive first, and each
 * check short-circuits on failure so later, more expensive checks never
 * run — in particular, an oversized file is rejected by `file.size` alone
 * and its content is never read.
 */
export async function validateObj(file: File): Promise<ValidateObjResult> {
  if (!OBJ_EXTENSION_PATTERN.test(file.name)) {
    return {
      valid: false,
      errors: [`File must have a ".obj" extension (got "${file.name}").`],
    }
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      valid: false,
      errors: [
        `File is too large (${file.size} bytes); the maximum is ${MAX_UPLOAD_BYTES} bytes (500 MB).`,
      ],
    }
  }

  if (file.size === 0) {
    return { valid: false, errors: ['File is empty.'] }
  }

  const head = await readHead(file)
  if (!VERTEX_LINE_PATTERN.test(head) || !FACE_LINE_PATTERN.test(head)) {
    return {
      valid: false,
      errors: [
        'File does not look like OBJ content (no "v " / "f " prefixed lines found in the first 64 KB).',
      ],
    }
  }

  return { valid: true, errors: [] }
}
