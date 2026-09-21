//! Chunked-upload session state: the S3-multipart-shaped protocol the
//! client and server use to move a large `.obj` file to the server in
//! parts.

use serde::{Deserialize, Serialize};

use crate::ids::UploadId;

/// Lifecycle of an in-progress chunked upload session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UploadStatus {
    /// Accepting parts; not all parts have arrived yet.
    Pending,
    /// All parts received and validated; finalized into a model + job.
    Completed,
    /// Explicitly aborted by the client, or swept after expiry.
    Aborted,
}

/// A part's server-assigned integrity token, returned to the client after
/// a successful chunk upload and echoed back on `complete`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PartEtag(pub String);

/// Record of one received, validated chunk of an in-progress upload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PartRecord {
    pub upload_id: UploadId,
    pub part_number: u32,
    pub size_bytes: u64,
    pub etag: PartEtag,
}

/// Session state for a chunked upload, from initiation through completion
/// or abort.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UploadSession {
    pub id: UploadId,
    pub filename: String,
    /// Size in bytes the client declared up front; validated against
    /// `limits::MAX_UPLOAD_BYTES` and against the sum of received parts.
    pub declared_size_bytes: u64,
    pub chunk_size_bytes: u64,
    pub status: UploadStatus,
    /// Unix epoch milliseconds when the session was created.
    pub created_at: u64,
    /// Unix epoch milliseconds after which an incomplete session is
    /// eligible for the expiry sweeper.
    pub expires_at: u64,
}
