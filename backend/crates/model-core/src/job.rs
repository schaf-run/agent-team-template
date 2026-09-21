//! Background transcode job state: what runs after an upload completes.

use serde::{Deserialize, Serialize};

use crate::ids::ModelId;

/// Lifecycle of a background transcode job.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobState {
    /// Enqueued but not yet picked up by a worker.
    Queued,
    /// A worker is actively running the transcode pipeline.
    Running,
    /// The pipeline finished and the model's LOD ladder is ready.
    Succeeded,
    /// The pipeline failed; see the job's `error` field for detail.
    Failed,
}

/// Coarse pipeline stage, used to give the client an honest progress label.
/// Weighted roughly as: parse 0-40, dedup 40-50, simplify 50-80, encode
/// 80-100.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStage {
    Parse,
    Dedup,
    Simplify,
    Encode,
    Done,
}

/// A point-in-time progress report for a running job.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct JobProgress {
    pub stage: JobStage,
    /// 0-100, monotonically non-decreasing over the life of a job.
    pub percent: u8,
}

impl JobProgress {
    /// The initial progress state for a freshly enqueued job.
    #[must_use]
    pub fn queued() -> Self {
        Self {
            stage: JobStage::Parse,
            percent: 0,
        }
    }

    /// The terminal progress state for a successfully finished job.
    #[must_use]
    pub fn done() -> Self {
        Self {
            stage: JobStage::Done,
            percent: 100,
        }
    }
}

/// A background transcode job for one model.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TranscodeJob {
    pub model_id: ModelId,
    pub state: JobState,
    pub progress: JobProgress,
    /// Populated once `state` is `Failed`; a user-facing failure summary.
    pub error: Option<String>,
    /// Unix epoch milliseconds when the job was created.
    pub created_at: u64,
    /// Unix epoch milliseconds when the job was last updated.
    pub updated_at: u64,
}
