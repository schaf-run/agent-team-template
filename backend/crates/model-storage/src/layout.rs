//! Key layout for [`crate::fs_blob_store::FsBlobStore`]: maps opaque
//! `BlobStore` keys to filesystem paths under a configured root, and
//! defends every key against path traversal before it ever touches the
//! filesystem.
//!
//! Layout:
//! - `models/{id}/original.obj` — the finalized original upload.
//! - `models/{id}/lod{n}.glb` — encoded LOD assets.
//! - `tmp/{upload_id}/{n}.part` — in-progress multipart upload parts.

use std::path::{Component, Path, PathBuf};

use model_core::CoreError;

/// Directory (relative to the store root) holding finalized model assets.
pub const MODELS_DIR: &str = "models";

/// Directory (relative to the store root) holding in-progress multipart
/// upload parts.
pub const TMP_DIR: &str = "tmp";

/// Build the key for a model's original upload: `models/{id}/original.obj`.
#[must_use]
pub fn original_key(model_id: &str) -> String {
    format!("{MODELS_DIR}/{model_id}/original.obj")
}

/// Build the key for a model's LOD asset at level `n`: `models/{id}/lod{n}.glb`.
#[must_use]
pub fn lod_key(model_id: &str, level: u32) -> String {
    format!("{MODELS_DIR}/{model_id}/lod{level}.glb")
}

/// Build the key for one part of an in-progress multipart upload:
/// `tmp/{upload_id}/{n}.part`.
#[must_use]
pub fn part_key(upload_id: &str, part_number: u32) -> String {
    format!("{TMP_DIR}/{upload_id}/{part_number}.part")
}

/// Build the key for the directory holding all parts of a multipart
/// upload: `tmp/{upload_id}`.
#[must_use]
pub fn upload_tmp_dir_key(upload_id: &str) -> String {
    format!("{TMP_DIR}/{upload_id}")
}

/// Resolve an opaque `key` to an absolute filesystem path under `root`,
/// rejecting any key that could escape `root`: `..` segments, an absolute
/// path/prefix, or an empty key.
///
/// This is a purely lexical check — it does not require the path (or any
/// of its ancestors) to already exist, so it is safe to call before
/// creating parent directories on a `put`. It must be called, and its
/// error propagated, before any filesystem operation derived from a
/// caller-supplied key.
pub fn resolve_key(root: &Path, key: &str) -> Result<PathBuf, CoreError> {
    if key.is_empty() {
        return Err(CoreError::InvalidInput(
            "blob key must not be empty".to_owned(),
        ));
    }

    let mut resolved = root.to_path_buf();
    for component in Path::new(key).components() {
        match component {
            Component::Normal(part) => resolved.push(part),
            // A lone "." segment is a harmless no-op; drop it rather than
            // rejecting, since it can't cause escape.
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(CoreError::InvalidInput(format!(
                    "blob key {key:?} contains a disallowed path segment"
                )));
            }
        }
    }

    // Belt-and-suspenders: confirm the lexically-joined path still lives
    // under `root`. The component scan above should make this always
    // true, but this guards against any future change to that loop
    // silently reopening a traversal path.
    if !resolved.starts_with(root) {
        return Err(CoreError::InvalidInput(format!(
            "blob key {key:?} resolves outside the store root"
        )));
    }

    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_have_expected_shape() {
        assert_eq!(original_key("m1"), "models/m1/original.obj");
        assert_eq!(lod_key("m1", 2), "models/m1/lod2.glb");
        assert_eq!(part_key("u1", 3), "tmp/u1/3.part");
        assert_eq!(upload_tmp_dir_key("u1"), "tmp/u1");
    }

    #[test]
    fn resolve_key_accepts_well_formed_keys() {
        let root = Path::new("/store");
        let resolved = resolve_key(root, "models/m1/original.obj").unwrap();
        assert_eq!(resolved, root.join("models/m1/original.obj"));
    }

    #[test]
    fn resolve_key_rejects_parent_dir_traversal() {
        let root = Path::new("/store");
        assert!(resolve_key(root, "../../etc/passwd").is_err());
        assert!(resolve_key(root, "models/../../etc/passwd").is_err());
        assert!(resolve_key(root, "models/m1/../../../etc/passwd").is_err());
    }

    #[test]
    fn resolve_key_rejects_absolute_paths() {
        let root = Path::new("/store");
        assert!(resolve_key(root, "/etc/passwd").is_err());
    }

    #[test]
    fn resolve_key_rejects_empty_key() {
        let root = Path::new("/store");
        assert!(resolve_key(root, "").is_err());
    }
}
