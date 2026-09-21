//! `MetadataStore`: the only abstraction over persisted relational
//! metadata — models, share links, upload sessions/parts, and transcode
//! jobs. `model-storage` provides the SQLite implementation; this crate
//! only defines the seam.

use async_trait::async_trait;

use crate::error::CoreError;
use crate::ids::{ModelId, ShareSlug, UploadId};
use crate::job::{JobState, TranscodeJob};
use crate::model::ModelRecord;
use crate::upload::{PartRecord, UploadSession, UploadStatus};

/// CRUD-plus-transitions access to all persisted metadata. Implementations
/// own transactional integrity for any method documented as atomic here.
#[async_trait]
pub trait MetadataStore: Send + Sync {
    /// Insert a newly created model record.
    async fn insert_model(&self, model: &ModelRecord) -> Result<(), CoreError>;

    /// Fetch a model by its internal id.
    async fn get_model(&self, id: ModelId) -> Result<Option<ModelRecord>, CoreError>;

    /// Fetch a model via its public share slug (the viewer's lookup path).
    async fn get_model_by_slug(&self, slug: &ShareSlug) -> Result<Option<ModelRecord>, CoreError>;

    /// Overwrite a model record (status transitions, bounds/stats on completion, error detail on failure).
    async fn update_model(&self, model: &ModelRecord) -> Result<(), CoreError>;

    /// Associate a share slug with a model.
    async fn insert_share_link(&self, model_id: ModelId, slug: &ShareSlug)
    -> Result<(), CoreError>;

    /// Resolve a share slug to its owning model id, if the link exists.
    async fn resolve_share_slug(&self, slug: &ShareSlug) -> Result<Option<ModelId>, CoreError>;

    /// Create a new upload session.
    async fn insert_upload_session(&self, session: &UploadSession) -> Result<(), CoreError>;

    /// Fetch an upload session by id.
    async fn get_upload_session(&self, id: UploadId) -> Result<Option<UploadSession>, CoreError>;

    /// Update a session's status (e.g. mark completed or aborted).
    async fn update_upload_session_status(
        &self,
        id: UploadId,
        status: UploadStatus,
    ) -> Result<(), CoreError>;

    /// List upload sessions whose `expires_at` is before `expires_before` (unix epoch millis), for the expiry sweeper.
    async fn list_expired_upload_sessions(
        &self,
        expires_before: u64,
    ) -> Result<Vec<UploadSession>, CoreError>;

    /// Record one received, validated part.
    async fn insert_part(&self, part: &PartRecord) -> Result<(), CoreError>;

    /// List all parts received so far for a session, in part-number order.
    async fn list_parts(&self, upload_id: UploadId) -> Result<Vec<PartRecord>, CoreError>;

    /// Insert a newly enqueued transcode job.
    async fn insert_job(&self, job: &TranscodeJob) -> Result<(), CoreError>;

    /// Fetch the transcode job for a model.
    async fn get_job(&self, model_id: ModelId) -> Result<Option<TranscodeJob>, CoreError>;

    /// Persist a job's state/progress/error transition.
    async fn update_job(&self, job: &TranscodeJob) -> Result<(), CoreError>;

    /// List jobs in the given state, for the runner's dispatch loop and the startup sweep that re-enqueues interrupted jobs.
    async fn list_jobs_in_state(&self, state: JobState) -> Result<Vec<TranscodeJob>, CoreError>;

    /// Atomically finalize an upload: mark the session completed, insert
    /// the model record, insert its share link, and enqueue its transcode
    /// job. Implementations must roll back all writes together on failure.
    async fn complete_upload(
        &self,
        upload_id: UploadId,
        model: ModelRecord,
        slug: ShareSlug,
        job: TranscodeJob,
    ) -> Result<(), CoreError>;
}
