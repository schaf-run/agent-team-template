/**
 * SHA-256 helpers backed by WebCrypto (`crypto.subtle`), available in both
 * browsers and the Vitest/jsdom test environment — no extra dependency.
 */

/**
 * Hashes `input` and returns the digest as lowercase hex, matching the
 * `X-Chunk-SHA256` format the server expects (contract §uploadPart).
 */
export async function sha256Hex(input: Blob | ArrayBuffer): Promise<string> {
  const buffer = input instanceof Blob ? await input.arrayBuffer() : input
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return bufferToHex(digest)
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
