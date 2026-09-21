//! Identifier types: internal `ModelId`/`UploadId` (ULID-backed, sortable,
//! never exposed to clients) and the public `ShareSlug` (CSPRNG-generated,
//! IS the access credential for an unauthenticated share link).

use std::fmt;
use std::str::FromStr;

use rand::TryRng;
use rand::rngs::SysRng;
use serde::{Deserialize, Serialize};
use ulid::Ulid;

use crate::error::CoreError;

/// Base62 alphabet used for `ShareSlug`s: digits, uppercase, lowercase.
/// Deliberately avoids `+`, `/`, `=` so slugs are safe to embed directly in
/// a URL path with no percent-encoding.
const BASE62_ALPHABET: &[u8; 62] =
    b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/// Only accept raw bytes below this threshold when mapping into the base62
/// alphabet via `% 62`, so the mapping stays uniform: `256 = 4*62 + 8`, and
/// `4*62 = 248` is the largest multiple of 62 not exceeding 256.
const REJECTION_THRESHOLD: u8 = 248;

/// Length in characters of a generated `ShareSlug` (~131 bits of entropy).
pub const SHARE_SLUG_LEN: usize = 22;

/// Internal, time-sortable identifier for a model. Never exposed to
/// clients — only the [`ShareSlug`] is public.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ModelId(Ulid);

impl ModelId {
    /// Mint a new, time-ordered `ModelId`.
    #[must_use]
    pub fn new() -> Self {
        Self(Ulid::generate())
    }
}

impl Default for ModelId {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for ModelId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(&self.0, f)
    }
}

impl FromStr for ModelId {
    type Err = CoreError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ulid::from_str(s)
            .map(Self)
            .map_err(|err| CoreError::InvalidInput(format!("invalid model id: {err}")))
    }
}

/// Internal, time-sortable identifier for an in-progress upload session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct UploadId(Ulid);

impl UploadId {
    /// Mint a new, time-ordered `UploadId`.
    #[must_use]
    pub fn new() -> Self {
        Self(Ulid::generate())
    }
}

impl Default for UploadId {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for UploadId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(&self.0, f)
    }
}

impl FromStr for UploadId {
    type Err = CoreError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ulid::from_str(s)
            .map(Self)
            .map_err(|err| CoreError::InvalidInput(format!("invalid upload id: {err}")))
    }
}

/// The public, unguessable access credential for a model's share link: a
/// 22-character base62 string (~131 bits of entropy) drawn from the
/// system's cryptographically secure RNG.
///
/// This is deliberately never derived from a filename, timestamp, or
/// counter — with no auth in scope, the slug's unguessability IS the
/// entire security model for `/v/{slug}`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ShareSlug(String);

impl ShareSlug {
    /// Generate a new random slug from the system CSPRNG.
    #[must_use]
    pub fn generate() -> Self {
        let mut rng = SysRng;
        let mut out = String::with_capacity(SHARE_SLUG_LEN);
        let mut byte = [0u8; 1];
        while out.len() < SHARE_SLUG_LEN {
            rng.try_fill_bytes(&mut byte)
                .expect("system RNG must be available to mint a share slug");
            if byte[0] < REJECTION_THRESHOLD {
                out.push(BASE62_ALPHABET[(byte[0] % 62) as usize] as char);
            }
        }
        Self(out)
    }

    /// Borrow the slug as a plain string (e.g. to embed in a URL path).
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for ShareSlug {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl FromStr for ShareSlug {
    type Err = CoreError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        if s.len() == SHARE_SLUG_LEN && s.bytes().all(|b| BASE62_ALPHABET.contains(&b)) {
            Ok(Self(s.to_owned()))
        } else {
            Err(CoreError::InvalidInput("invalid share slug".to_owned()))
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::{HashMap, HashSet};

    use super::*;

    #[test]
    fn slug_alphabet_is_url_safe_base62() {
        let slug = ShareSlug::generate();
        assert_eq!(slug.as_str().len(), SHARE_SLUG_LEN);
        assert!(slug.as_str().bytes().all(|b| b.is_ascii_alphanumeric()));
        assert!(!slug.as_str().contains(['+', '/', '=']));
        // Round-trips through FromStr/Display, which is the actual
        // URL-safety contract callers rely on.
        let parsed: ShareSlug = slug.as_str().parse().expect("generated slug must parse");
        assert_eq!(parsed, slug);
    }

    #[test]
    fn slug_generation_is_not_degenerate() {
        let mut seen = HashSet::new();
        let mut char_counts: HashMap<char, u32> = HashMap::new();
        for _ in 0..1000 {
            let slug = ShareSlug::generate();
            assert_eq!(slug.as_str().len(), SHARE_SLUG_LEN);
            for c in slug.as_str().chars() {
                *char_counts.entry(c).or_insert(0) += 1;
            }
            seen.insert(slug.as_str().to_owned());
        }
        // 1000 draws from a ~131-bit space should never collide.
        assert_eq!(seen.len(), 1000, "unexpected collision in 1000 draws");
        // 1000 * 22 = 22000 draws over a 62-symbol alphabet should exercise
        // most of the alphabet if generation isn't stuck/degenerate.
        assert!(
            char_counts.len() > 40,
            "suspiciously few distinct characters produced: {}",
            char_counts.len()
        );
    }

    #[test]
    fn model_id_roundtrips_through_string() {
        let id = ModelId::new();
        let parsed: ModelId = id.to_string().parse().expect("must parse");
        assert_eq!(id, parsed);
    }

    #[test]
    fn upload_id_roundtrips_through_string() {
        let id = UploadId::new();
        let parsed: UploadId = id.to_string().parse().expect("must parse");
        assert_eq!(id, parsed);
    }

    #[test]
    fn invalid_share_slug_is_rejected() {
        assert!("too-short".parse::<ShareSlug>().is_err());
        assert!("!".repeat(SHARE_SLUG_LEN).parse::<ShareSlug>().is_err());
    }
}
