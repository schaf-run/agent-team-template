-- Initial schema for model-storage's SqliteMetadataStore.
--
-- Column shapes are derived directly from the domain types in
-- `model-core`: `model.rs` (ModelRecord/ModelStatus/Bounds/MeshStats),
-- `ids.rs` (ModelId/UploadId/ShareSlug), `upload.rs`
-- (UploadSession/UploadStatus/PartRecord/PartEtag), and `job.rs`
-- (TranscodeJob/JobState/JobProgress/JobStage).
--
-- `id`/`model_id`/`upload_id` columns store ULIDs (model.rs, ids.rs:
-- "Internal, sortable identifier ... never exposed to clients") as their
-- canonical 26-character string encoding. `slug` stores the 22-char
-- base62 `ShareSlug` (ids.rs) -- the public access credential (plan
-- §4.3), kept in a separate table from `models` per that section so
-- revocation/expiry/multiple-links-per-model stay additive.
--
-- `u64`/`u32`/`u8` domain fields map to SQLite `INTEGER` (64-bit signed);
-- values in this domain (byte sizes up to the 500 MB upload cap, part
-- numbers, 0-100 percentages) fit comfortably.

-- A persisted model: identity, source metadata, and current status
-- (model.rs::ModelRecord).
CREATE TABLE models (
    id TEXT PRIMARY KEY NOT NULL,
    filename TEXT NOT NULL,
    source_bytes INTEGER NOT NULL,
    status TEXT NOT NULL
        CHECK (status IN ('queued', 'processing', 'ready', 'failed')),
    -- Option<Bounds>: populated once `status` is 'ready'. Bounds is a
    -- fixed-shape struct (min/max/center: [f32; 3], radius: f32);
    -- stored as a JSON blob rather than nine separate nullable columns.
    bounds_json TEXT,
    -- Option<MeshStats>: populated once `status` is 'ready'.
    stats_json TEXT,
    -- Option<String>: populated once `status` is 'failed'.
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- The public share credential for a model (ids.rs::ShareSlug), kept
-- separate from `models` per plan §4.3. The unique index on `slug` is
-- load-bearing for correctness: it is the sole mechanism preventing two
-- models from ever resolving to the same public URL.
CREATE TABLE share_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id TEXT NOT NULL REFERENCES models (id),
    slug TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX share_links_slug_idx ON share_links (slug);

-- Chunked-upload session state (upload.rs::UploadSession).
CREATE TABLE upload_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    filename TEXT NOT NULL,
    declared_size_bytes INTEGER NOT NULL,
    chunk_size_bytes INTEGER NOT NULL,
    status TEXT NOT NULL
        CHECK (status IN ('pending', 'completed', 'aborted')),
    created_at INTEGER NOT NULL,
    -- Drives the expiry sweeper (plan §6.3 B1-6) and the
    -- `GET /api/uploads/{id}` resume/expiry contract (plan §4.5).
    expires_at INTEGER NOT NULL
);

CREATE INDEX upload_sessions_expires_at_idx ON upload_sessions (expires_at);

-- One received, validated chunk of an in-progress upload
-- (upload.rs::PartRecord). Composite primary key doubles as the index
-- needed to answer `GET /api/uploads/{id}` (list received part numbers
-- in order) and to validate completeness/contiguity on
-- `POST /api/uploads/{id}/complete` (plan §4.5).
CREATE TABLE upload_parts (
    upload_id TEXT NOT NULL REFERENCES upload_sessions (id),
    part_number INTEGER NOT NULL,
    size_bytes INTEGER NOT NULL,
    etag TEXT NOT NULL,
    PRIMARY KEY (upload_id, part_number)
);

-- Background transcode job state (job.rs::TranscodeJob). One job per
-- model (MetadataStore::get_job takes a single ModelId and returns at
-- most one job), so `model_id` is the primary key.
CREATE TABLE transcode_jobs (
    model_id TEXT PRIMARY KEY NOT NULL REFERENCES models (id),
    state TEXT NOT NULL
        CHECK (state IN ('queued', 'running', 'succeeded', 'failed')),
    -- job.rs::JobProgress, flattened: stage label plus 0-100 percent.
    stage TEXT NOT NULL
        CHECK (stage IN ('parse', 'dedup', 'simplify', 'encode', 'done')),
    percent INTEGER NOT NULL CHECK (percent >= 0 AND percent <= 100),
    -- Option<String>: populated once `state` is 'failed'.
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Supports the job runner's dispatch loop and the startup sweep that
-- re-enqueues interrupted jobs (plan §3.1, §5).
CREATE INDEX transcode_jobs_state_idx ON transcode_jobs (state);
