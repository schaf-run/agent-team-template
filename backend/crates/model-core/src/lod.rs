//! LOD ladder types, plus a pure policy function deciding how many levels a
//! source mesh gets and what triangle count each level targets.

use serde::{Deserialize, Serialize};

/// Index of a level in the LOD ladder; 0 is the coarsest/smallest level.
pub type LodLevel = u8;

/// One level of the LOD ladder: triangle count, encoded byte size, and the
/// storage key/URL it can be fetched from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LodDescriptor {
    pub level: LodLevel,
    pub triangles: u64,
    pub byte_size: u64,
    pub key: String,
}

/// An ordered ladder of LOD levels, from coarsest (index 0) to finest.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct LodLadder {
    pub levels: Vec<LodDescriptor>,
}

impl LodLadder {
    #[must_use]
    pub fn new(levels: Vec<LodDescriptor>) -> Self {
        Self { levels }
    }

    /// The smallest, first-to-load level, if any.
    #[must_use]
    pub fn coarsest(&self) -> Option<&LodDescriptor> {
        self.levels.first()
    }

    /// The largest, highest-detail level, if any.
    #[must_use]
    pub fn finest(&self) -> Option<&LodDescriptor> {
        self.levels.last()
    }
}

/// Target triangle count for L0, the coarsest ladder level.
pub const LOD_L0_TARGET_TRIANGLES: u64 = 50_000;

/// Target growth factor between consecutive levels: each level up targets
/// roughly this many times more triangles than the level below it.
pub const LOD_LEVEL_GROWTH_FACTOR: f64 = 5.0;

/// Once a candidate level would land within this factor of the full source
/// triangle count, stop the ladder there (using the exact source count)
/// rather than adding a level that isn't meaningfully cheaper to serve.
pub const LOD_STOP_WITHIN_FACTOR: f64 = 1.5;

/// Pure policy function: given a source triangle count, decide the target
/// triangle count for each LOD level, coarsest first. This does no
/// simplification itself — `model-transcode` is responsible for actually
/// producing geometry at each target.
///
/// Rules: L0 targets ~50k triangles; each subsequent level targets ~5x the
/// previous; the ladder stops once a candidate would land within 1.5x of
/// the source, at which point the final level is sized to the exact source
/// count. A source already within 1.5x of the L0 target collapses to a
/// single level.
#[must_use]
pub fn plan_lod_triangle_targets(source_triangles: u64) -> Vec<u64> {
    if source_triangles == 0 {
        return Vec::new();
    }

    let source = source_triangles as f64;

    if source <= LOD_L0_TARGET_TRIANGLES as f64 * LOD_STOP_WITHIN_FACTOR {
        return vec![source_triangles];
    }

    let mut targets = Vec::new();
    let mut level = LOD_L0_TARGET_TRIANGLES as f64;

    loop {
        if source / level <= LOD_STOP_WITHIN_FACTOR {
            targets.push(source_triangles);
            break;
        }
        targets.push(level.round() as u64);
        level *= LOD_LEVEL_GROWTH_FACTOR;
    }

    targets
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_source_yields_no_levels() {
        assert!(plan_lod_triangle_targets(0).is_empty());
    }

    #[test]
    fn small_source_yields_exactly_one_level() {
        // Matches the plan's B2-4 acceptance criterion: a 5k-tri input
        // yields exactly 1 level.
        let targets = plan_lod_triangle_targets(5_000);
        assert_eq!(targets, vec![5_000]);
    }

    #[test]
    fn ten_million_triangles_yields_five_levels() {
        let targets = plan_lod_triangle_targets(10_000_000);
        assert_eq!(targets.len(), 5);
        assert_eq!(targets[0], 50_000);
        assert_eq!(*targets.last().unwrap(), 10_000_000);
    }

    #[test]
    fn targets_are_strictly_increasing_and_within_stop_factor_of_source() {
        for source in [5_000, 60_000, 300_000, 2_000_000, 10_000_000, 80_000_000] {
            let targets = plan_lod_triangle_targets(source);
            assert!(!targets.is_empty());
            for pair in targets.windows(2) {
                assert!(pair[0] < pair[1]);
            }
            let last = *targets.last().unwrap();
            assert_eq!(last, source, "final level must equal the source count");
        }
    }
}
