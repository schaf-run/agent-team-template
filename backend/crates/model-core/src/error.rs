//! The core crate's error type. Storage and domain-logic failures both
//! flow through this so callers (transcode pipeline, API layer) have one
//! error taxonomy to map from.

use thiserror::Error;

/// Errors surfaced by `model-core` traits and pure domain logic.
#[derive(Debug, Error)]
pub enum CoreError {
    /// The requested entity does not exist.
    #[error("not found: {0}")]
    NotFound(String),

    /// Caller-supplied input failed validation.
    #[error("invalid input: {0}")]
    InvalidInput(String),

    /// An upload exceeded `limits::MAX_UPLOAD_BYTES`.
    #[error("upload of {actual} bytes exceeds the {max}-byte limit")]
    UploadTooLarge { max: u64, actual: u64 },

    /// A source mesh exceeded `limits::MAX_VERTICES`/`limits::MAX_FACES`.
    #[error("mesh exceeds limits: {0}")]
    MeshTooLarge(String),

    /// An operation conflicted with existing state (e.g. duplicate slug).
    #[error("conflict: {0}")]
    Conflict(String),

    /// A storage backend (blob or metadata) failed.
    #[error("storage error: {0}")]
    Storage(String),

    /// Any other internal failure that isn't user-actionable.
    #[error("internal error: {0}")]
    Internal(String),
}
