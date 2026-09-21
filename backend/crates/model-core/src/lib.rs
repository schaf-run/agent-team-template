//! `model-core`: domain types and traits shared across the transcoding
//! pipeline (mesh/LOD/manifest representations, storage traits, etc.).
//!
//! This crate is pure domain logic: no `axum`, no `tokio::net`, no `sqlx`.
//! `async_trait` is used only for the `BlobStore`/`MetadataStore` trait
//! method signatures, and `tokio::io` only for its `AsyncRead` type used by
//! `BlobStore`'s streaming signatures.

pub mod blob_store;
pub mod error;
pub mod ids;
pub mod job;
pub mod limits;
pub mod lod;
pub mod metadata_store;
pub mod model;
pub mod upload;

pub use blob_store::{
    BlobMeta, BlobStore, BoxAsyncRead, ByteRange, MultipartPart, MultipartUploadId,
};
pub use error::CoreError;
pub use ids::{ModelId, SHARE_SLUG_LEN, ShareSlug, UploadId};
pub use job::{JobProgress, JobStage, JobState, TranscodeJob};
pub use limits::{MAX_FACES, MAX_UPLOAD_BYTES, MAX_VERTICES, UPLOAD_CHUNK_BYTES};
pub use lod::{
    LOD_L0_TARGET_TRIANGLES, LOD_LEVEL_GROWTH_FACTOR, LOD_STOP_WITHIN_FACTOR, LodDescriptor,
    LodLadder, LodLevel, plan_lod_triangle_targets,
};
pub use metadata_store::MetadataStore;
pub use model::{Bounds, MeshStats, ModelRecord, ModelStatus};
pub use upload::{PartEtag, PartRecord, UploadSession, UploadStatus};
