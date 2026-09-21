//! Model domain records: status lifecycle, geometry bounds, and mesh
//! statistics.

use serde::{Deserialize, Serialize};

use crate::ids::ModelId;

/// Lifecycle of a model from upload completion through transcoding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelStatus {
    /// Upload finalized; the transcode job is enqueued but not yet
    /// started.
    Queued,
    /// The transcode job is actively running.
    Processing,
    /// Transcoding finished; the LOD ladder is available.
    Ready,
    /// Transcoding failed; see the model's `error` field for detail.
    Failed,
}

/// A persisted model: identity, source metadata, and current status.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelRecord {
    /// Internal, sortable identifier. Never exposed to clients.
    pub id: ModelId,
    /// Original uploaded filename, for display only.
    pub filename: String,
    /// Size in bytes of the original `.obj` upload.
    pub source_bytes: u64,
    /// Current lifecycle status.
    pub status: ModelStatus,
    /// Populated once `status` is `Ready`.
    pub bounds: Option<Bounds>,
    /// Populated once `status` is `Ready`.
    pub stats: Option<MeshStats>,
    /// Populated once `status` is `Failed`; a user-facing failure summary.
    pub error: Option<String>,
    /// Unix epoch milliseconds when the model was created.
    pub created_at: u64,
    /// Unix epoch milliseconds when the model record was last updated.
    pub updated_at: u64,
}

/// Axis-aligned bounding box plus a bounding sphere, computed server-side
/// so the viewer can frame its camera before any geometry has arrived.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Bounds {
    pub min: [f32; 3],
    pub max: [f32; 3],
    pub center: [f32; 3],
    pub radius: f32,
}

impl Bounds {
    /// Derive center and bounding-sphere radius from an AABB's corners.
    #[must_use]
    pub fn from_min_max(min: [f32; 3], max: [f32; 3]) -> Self {
        let center = [
            (min[0] + max[0]) / 2.0,
            (min[1] + max[1]) / 2.0,
            (min[2] + max[2]) / 2.0,
        ];
        let dx = max[0] - min[0];
        let dy = max[1] - min[1];
        let dz = max[2] - min[2];
        let radius = (dx * dx + dy * dy + dz * dz).sqrt() / 2.0;
        Self {
            min,
            max,
            center,
            radius,
        }
    }
}

/// Geometry statistics for the source mesh (pre-LOD-ladder).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct MeshStats {
    pub source_bytes: u64,
    pub vertices: u64,
    pub triangles: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds_from_min_max_computes_center_and_radius() {
        let bounds = Bounds::from_min_max([-1.0, -1.0, -1.0], [1.0, 1.0, 1.0]);
        assert_eq!(bounds.center, [0.0, 0.0, 0.0]);
        // Half-diagonal of a 2x2x2 cube is sqrt(12)/2 = sqrt(3).
        assert!((bounds.radius - 3.0_f32.sqrt()).abs() < 1e-5);
    }
}
