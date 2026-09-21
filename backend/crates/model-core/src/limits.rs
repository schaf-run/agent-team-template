//! Hard, defensible limits enforced across the upload and transcode
//! pipeline. These exist to bound memory use and to defend against
//! accidental or malicious parse-bomb `.obj` files.

/// Maximum accepted size of an original upload, in bytes (500 MB).
pub const MAX_UPLOAD_BYTES: u64 = 500 * 1024 * 1024;

/// Size of each upload chunk/part, in bytes (8 MB), as advertised to
/// clients by the upload-initiate response.
pub const UPLOAD_CHUNK_BYTES: u64 = 8 * 1024 * 1024;

/// Hard cap on source vertex count; inputs above this are rejected.
pub const MAX_VERTICES: u64 = 100_000_000;

/// Hard cap on source triangle/face count; inputs above this are rejected.
pub const MAX_FACES: u64 = 200_000_000;
