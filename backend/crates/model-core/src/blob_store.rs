//! `BlobStore`: the only abstraction over raw byte storage (originals and
//! encoded LOD assets). Keys are opaque, storage-defined paths (e.g.
//! `models/{id}/lod0.glb`); implementations own filesystem/bucket detail.
//!
//! Streaming is expressed via boxed `tokio::io::AsyncRead`/`AsyncWrite`
//! trait objects rather than pulling in a `Bytes`-style crate, so a 500 MB
//! object is never required to sit fully in memory on either side of a
//! call.

use std::pin::Pin;

use async_trait::async_trait;
use tokio::io::AsyncRead;

use crate::error::CoreError;

/// A boxed, owned, `Send`-able async byte stream.
pub type BoxAsyncRead = Pin<Box<dyn AsyncRead + Send + Unpin + 'static>>;

/// A byte range request, matching HTTP `Range` semantics (inclusive on
/// both ends).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ByteRange {
    pub start: u64,
    /// Inclusive end offset; `None` means "to the end of the object".
    pub end: Option<u64>,
}

/// Metadata about a stored object, as returned by `head`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlobMeta {
    pub size_bytes: u64,
    pub etag: String,
}

/// Server-assigned handle for an in-progress multipart upload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MultipartUploadId(pub String);

/// One completed part of a multipart upload, as reported back by the
/// caller when completing it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MultipartPart {
    pub part_number: u32,
    pub etag: String,
    pub size_bytes: u64,
}

/// Abstraction over byte storage for original uploads and encoded LOD
/// assets.
#[async_trait]
pub trait BlobStore: Send + Sync {
    /// Stream exactly `len_bytes` from `body` and store it under `key`, replacing any existing object there; returns the stored object's etag.
    async fn put(&self, key: &str, body: BoxAsyncRead, len_bytes: u64)
    -> Result<String, CoreError>;

    /// Open a streaming reader for `key`, optionally restricted to `range`.
    async fn get(&self, key: &str, range: Option<ByteRange>) -> Result<BoxAsyncRead, CoreError>;

    /// Fetch size/etag for `key` without reading its body.
    async fn head(&self, key: &str) -> Result<BlobMeta, CoreError>;

    /// Remove the object at `key`; not an error if it doesn't exist.
    async fn delete(&self, key: &str) -> Result<(), CoreError>;

    /// Begin a multipart upload for `key`, returning its upload id.
    async fn create_multipart(&self, key: &str) -> Result<MultipartUploadId, CoreError>;

    /// Stream one numbered part of `len_bytes` for an in-progress multipart upload; returns that part's etag.
    async fn put_part(
        &self,
        upload_id: &MultipartUploadId,
        part_number: u32,
        body: BoxAsyncRead,
        len_bytes: u64,
    ) -> Result<String, CoreError>;

    /// Assemble the given, ordered parts into the final object at `key`.
    async fn complete_multipart(
        &self,
        upload_id: &MultipartUploadId,
        key: &str,
        parts: Vec<MultipartPart>,
    ) -> Result<BlobMeta, CoreError>;

    /// Discard an in-progress multipart upload and any parts received so far.
    async fn abort_multipart(&self, upload_id: &MultipartUploadId) -> Result<(), CoreError>;
}
