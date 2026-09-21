# Architecture & Execution Plan: Large-Model `.obj` Share-and-View Web App

**Status:** Approved plan, ready for task distribution.
**Scope:** Application code only — frontend, backend, and the contract between them. Infra/deploy/CI, auth, payments, and non-`.obj` formats are explicitly out of scope, though the design must not preclude them.
**Date:** 2026-09-21

---

## 0. Executive Summary (read this if you read nothing else)

The whole architecture is driven by one fact: **a 500 MB `.obj` file must never be sent to a browser.**

`.obj` is an ASCII text format. A 500 MB `.obj` is roughly 5 million vertices and 10 million triangles. Parsing it in JavaScript means text-decoding 500 MB, splitting strings, and running ~50 million `parseFloat` calls. Realistic throughput for the best JS OBJ parsers is 10–30 MB/s, so 20–50 seconds of work, with peak memory in the 2–3 GB range (the source string, the intermediate arrays, and the dedup map all coexist). On a mid-range laptop that is a multi-second freeze at best and a tab crash at worst — and it would be repeated by **every single viewer of the link**.

So the system is built around a **server-side transcode step**:

> Upload raw `.obj` (chunked, streamed to storage) → background Rust job parses it once → simplifies it into an LOD ladder → writes each level as a **meshopt-compressed GLB** → the viewer streams the smallest level first (~400 KB) and progressively upgrades.

The payoff is concrete: **time-to-first-pixel is driven by ~400 KB of transfer instead of 500 MB — about three orders of magnitude fewer bytes** — and the expensive parse is paid once by the server rather than once per viewer.

**Stack decision: React + Rust is confirmed.** Both preferences hold up well here and I am not deviating on either. The specific picks are `axum` on the backend and `three.js` + `@react-three/fiber` on the frontend, with the one notable *addition* being the server-side transcode stage, which is not a deviation so much as the thing that makes the rest of the plan work.

---

## 1. Stack Decision

### 1.1 Backend: Rust — confirmed

| Decision | Choice | Rationale | Alternatives considered |
|---|---|---|---|
| Language | **Rust** | Confirmed. This workload is exactly Rust's sweet spot: streaming hundreds of MB to disk with tight memory control, and CPU-bound mesh simplification. A GC'd runtime would struggle with the 1–2 GB working set during transcode. | Node (fails the CPU-bound transcode), Go (viable, but the mesh tooling story is weaker) |
| Web framework | **`axum`** | Best-in-class streaming ergonomics (request bodies are `Stream`s, responses can be `Body::from_stream`), `tower`/`tower-http` gives CORS, compression, tracing, timeouts, and static serving as composable layers. Per-route body limits via `DefaultBodyLimit` matter a lot for us. Largest ecosystem overlap with `tokio`/`hyper`. | `actix-web` (fast and mature, but weaker `tower` interop and a more idiosyncratic extractor model), `rocket` (nicest ergonomics, historically weakest at streaming large bodies), `poem` (fine, smaller ecosystem) |
| Async runtime | **`tokio`** (multi-thread) | Required by axum; `spawn_blocking` is how we keep transcode off the async threads. | — |
| `.obj` parsing | **`tobj`** crate | The de-facto Rust OBJ parser. Handles `v`/`vn`/`vt`/`f`, the four face-index forms, negative indices, groups, and material references. Reads from any `BufRead`, so we can stream from storage. | Hand-written parser (see §1.4 — kept as a fallback if `tobj`'s peak memory is unacceptable) |
| Mesh simplification + compression | **`meshopt`** crate (Rust bindings over Google/zeux `meshoptimizer`) | Gives us `simplify` (quadric-error decimation for the LOD ladder), `optimize_vertex_cache`, `optimize_vertex_fetch`, `generate_vertex_remap` (dedup), and `encode_vertex_buffer`/`encode_index_buffer` — which is precisely the `EXT_meshopt_compression` wire format that three.js decodes natively. One dependency covers dedup, optimization, LOD, and compression. | `Draco` (better raw compression ratio, but slower decode, and no simplification), custom quadric simplifier (weeks of work, worse results) |
| Delivery format | **GLB (binary glTF 2.0), one file per LOD, `EXT_meshopt_compression`** | See §1.3 — this choice is what lets the frontend use an off-the-shelf loader instead of a bespoke binary parser. | Custom binary format, Draco-in-GLB, 3D Tiles / Nexus |
| GLB writing | **`gltf-json`** for the JSON chunk + ~60 lines of hand-rolled container writing | The GLB container is trivial: a 12-byte header plus length-prefixed JSON and BIN chunks. `gltf-json` gives us typed, spec-correct JSON. Rust's glTF *writer* crates are thin; this is the low-risk path. | `gltf` crate (read-focused), shelling out to `gltf-transform` (Node — rejected, adds a runtime dependency) |
| Metadata store | **SQLite via `sqlx`**, behind a `MetadataStore` trait | Zero infrastructure (one file on disk), but real SQL, real transactions, and real durability across restarts. Because it sits behind a trait and uses `sqlx`, swapping to Postgres later is a driver change plus one impl. | In-memory `HashMap` (loses everything on restart — unacceptable even in dev, since a 500 MB upload is expensive to redo), JSON sidecar files (racy, unqueryable), Postgres (an infra decision, which is out of scope) |
| Blob storage | **`BlobStore` trait + local-filesystem impl** | Keeps the S3/GCS door open without deciding anything now. The multipart methods are deliberately shaped like S3's multipart API. | Direct filesystem calls everywhere (would hard-code an infra assumption into every module) |
| IDs | `ulid` (internal) + `rand` CSPRNG base62 (public slug) | See §4.3. | `uuid` v4 (unsortable), auto-increment integers (enumerable — a security bug given link-only access) |
| Serialization | `serde` / `serde_json` | — | — |
| Errors / logging | `thiserror` (library crates), `anyhow` (binary), `tracing` + `tracing-subscriber` | Standard, and structured `tracing` spans are how we'll measure transcode stage timings. | — |
| Testing | built-in `#[test]`, `tower::ServiceExt::oneshot` for HTTP integration tests, `proptest` for the parser | Lets us test the full router in-process with no network. | — |

> **Note on versions:** I am deliberately not pinning version numbers, because I cannot verify current crate APIs from here. Task **B0-2** assigns a Senior Worker to pin every version and smoke-test the `meshopt` and `gltf-json` APIs against reality *before* the dependent tasks start. If a signature has drifted, that Worker reports back and I revise.

### 1.3 Delivery format: why GLB + meshopt

This is the highest-leverage decision in the document, so here is the full comparison.

| Option | First-render bytes (from 500 MB src) | Client decode cost | Client code required | Verdict |
|---|---|---|---|---|
| **Raw `.obj` to browser** | 500 MB | 20–50 s, 2–3 GB peak RAM, per viewer | `OBJLoader` | **Rejected.** Fails the core requirement outright. |
| **Custom binary format + LODs** | ~400 KB | Very low | Bespoke JS parser + bespoke worker plumbing | Rejected — all the benefit of GLB but we write and maintain the loader ourselves. |
| **GLB + Draco + LODs** | ~300 KB | Moderate (Draco decode is ~5–10× slower than meshopt) | `GLTFLoader` + `DRACOLoader` | Viable fallback. Better ratio, worse latency. |
| **GLB + meshopt + LODs** ✅ | ~400 KB | Very low (meshopt decode is ~1 GB/s, WASM, off-thread) | `GLTFLoader` + `MeshoptDecoder` — both off the shelf | **Chosen.** |
| **3D Tiles / Nexus (view-dependent streaming)** | ~100 KB | Low | Heavy client runtime | Over-engineered for this scope; noted as the Phase-2+ evolution path. |

Why GLB + meshopt wins: `three.js`'s `GLTFLoader` supports `EXT_meshopt_compression` natively via `loader.setMeshoptDecoder(MeshoptDecoder)`, where `MeshoptDecoder` ships in the `meshoptimizer` npm package. That single line deletes an entire category of custom-JS-parser work, and the decoder is a well-optimized WASM module that runs on its own worker pool. Meanwhile the *server* side of that format is produced by the same `meshopt` crate we're already using for simplification. The format also inherits glTF's tooling ecosystem (Blender, `gltf-transform`, the Khronos validator, drag-and-drop into any online viewer), which is worth a great deal during debugging.

It also future-proofs the out-of-scope items for free: when we later support `.obj` + `.mtl` + textures, or `.fbx`, or `.ply`, **the delivery format does not change** — only the parser front-end of the transcoder does. GLB already carries materials, textures, and scene hierarchy.

**Do not gzip GLB responses.** meshopt-encoded buffers are already entropy-coded; HTTP compression burns CPU for ~1–2%. Configure `CompressionLayer` with a predicate that excludes `model/gltf-binary`. Do compress the JSON manifest.

### 1.4 The one genuine risk: `tobj`'s peak memory

`tobj` parses into in-memory `Vec`s. Let me do the arithmetic explicitly, because it determines whether we need a fallback.

A typical ASCII `.obj` vertex line (`v 1.234567 2.345678 3.456789\n`) is ~30 bytes; a normal line is similar; a face line (`f 1/1/1 2/2/2 3/3/3\n`) is ~22 bytes. For a mesh with `V` vertices and ~`2V` triangles, file size ≈ `30V + 30V + 44V ≈ 104V`. So **500 MB ≈ 5M vertices / 10M triangles.**

The useful payload is modest: positions `5M × 12 B = 60 MB`, normals `60 MB`, indices `10M × 3 × 4 B = 120 MB` → ~240 MB of real data. But peak RSS during parse will be meaningfully higher — `Vec` doubling during growth, plus the `HashMap` used for vertex deduplication, plus `tobj`'s intermediate per-group structures. **Budget 1.5–2 GB peak for a 500 MB input.**

That is acceptable on a normal machine but it is not something to discover in production. Mitigations, in order:

1. **Pre-size the `Vec`s** from the file length (`V ≈ len / 104`) to eliminate doubling churn. Cheap, large win.
2. **Enforce a hard cap** on vertex and face counts (e.g. 100 M vertices) and abort with a clear user-facing error. This also defends against a malicious parse-bomb `.obj`.
3. **Limit transcode concurrency** to a small number (default 2) via a semaphore, so peak memory is `concurrency × 2 GB` and bounded.
4. **Fallback if (1)–(3) are insufficient:** replace `tobj` with a hand-written **two-pass streaming parser** — pass one counts `v`/`vn`/`vt`/`f` to size buffers exactly, pass two fills them, never holding the source text. This is a known, bounded piece of work and is pre-scoped as task **B1-7 (contingency)**.

Task **B0-2** measures this on a real synthetic 500 MB fixture before anything depends on it. This is deliberately front-loaded: it is the only place where I think the plan could need structural revision.

### 1.5 Frontend: React — confirmed

| Decision | Choice | Rationale | Alternatives considered |
|---|---|---|---|
| Framework | **React 18+, TypeScript, Vite** | Confirmed. Vite's dev server proxy makes the split frontend/backend dev loop painless, and its build output is straightforward to serve statically later. | Next.js (SSR buys us nothing — the viewer is inherently client-side and WebGL-bound; it would add an out-of-scope Node runtime) |
| 3D engine | **`three.js`** | Overwhelmingly the best-supported option, and the only one where our exact format path (`GLTFLoader` + `EXT_meshopt_compression`) is a first-class supported feature. | `babylon.js` (excellent, great loaders, but larger bundle and less idiomatic in React), `<model-viewer>` (too opinionated — no hook for custom LOD swapping), raw WebGL/WebGPU (absurd here) |
| React ↔ three binding | **`@react-three/fiber` (R3F) + `@react-three/drei`** | R3F gives declarative scene composition and clean lifecycle/disposal; `drei` gives us production-quality `OrbitControls`, `Bounds` (auto-framing), and `Grid` for free. Reconciler overhead is per-object and we have 1–10 objects, so it is irrelevant. | Raw `three.js` in a `useEffect` (less magic, but we'd re-implement orbit controls glue and disposal ourselves) |
| **Important caveat** | Put the *loading* logic in plain-TS modules and hooks, **not** in Suspense-based `useLoader` | Our loading is a stateful multi-stage pipeline (manifest → LOD0 → upgrade → upgrade) with progress reporting and cancellation. `useLoader`'s Suspense cache fights that. Use R3F for the *scene*, plain async code for the *pipeline*. | — |
| Mesh decode | **`meshoptimizer` npm (`MeshoptDecoder`)** wired into `GLTFLoader` | WASM, off main thread. | — |
| Upload client | **Hand-rolled chunked uploader** (see §1.6) using `File.slice()` + `fetch` | ~150 lines, no dependency, and mirrors S3 multipart. | `tus-js-client` (see §1.6) |
| State | **Zustand** (or plain context + reducer) | The app has very little global state: one upload session, one viewer session. Do not bring in a heavyweight store. | Redux Toolkit (overkill), TanStack Query (reasonable for the manifest poll, but the surface is 2 endpoints) |
| Routing | **React Router** | Two routes: `/` (upload) and `/v/:slug` (viewer). | — |
| Testing | **Vitest** (units/hooks), **MSW** (API mocking), **Playwright** (E2E incl. a WebGL smoke test via SwiftShader/ANGLE) | — | — |

### 1.6 Large-file upload: chunked, S3-multipart-shaped

| Option | Progress | Retry granularity | Resume after refresh | Server memory | Deps | Verdict |
|---|---|---|---|---|---|---|
| Single streamed multipart `POST` | Coarse (XHR upload events) | Whole file (!) | No | Constant (streamed) | None | **Rejected.** One network blip 480 MB in means starting over. Also forces a 500 MB body limit, which is a liability. |
| **Explicit chunked protocol** ✅ | Exact, per-chunk | Per-chunk | Yes (server reports received parts) | Constant, and body limit can be 16 MB | None | **Chosen.** |
| `tus` protocol (`rustus` + `tus-js-client`) | Exact | Per-chunk | Yes, very polished | Constant | Two | Strong runner-up — see below. |

I chose the explicit protocol over `tus` for two reasons. First, it is genuinely small: initiate / put-part / complete / abort / status is about 150 lines on each side, which is less code than integrating and configuring a `tus` server. Second and more importantly, **shaping our endpoints like S3's multipart API means the eventual swap to object storage is nearly free** — `create_multipart_upload` / `upload_part` / `complete_multipart_upload` map 1:1, and we can later switch to presigned part URLs so bytes bypass our server entirely, without changing the client's mental model. `tus` would give us a better resume story out of the box but would sit awkwardly on top of S3 multipart.

Chunk parameters:
- **Chunk size 8 MB** (server-advertised in the initiate response, so we can tune it without shipping a new client).
- **Concurrency 3** parallel chunk `PUT`s. Beyond ~4 the returns flatten and memory on the client rises.
- **Retry** with exponential backoff and jitter, 5 attempts per chunk.
- **Per-chunk integrity:** client sends `X-Chunk-SHA256`; server verifies. Server returns an `etag` per part; `complete` sends the ordered part list and the server validates the set is complete and contiguous. This catches silent corruption on a 500 MB transfer, which is not a hypothetical concern.
- **Server body limit for the part route: 16 MB.** The server therefore never needs to accept a 500 MB body anywhere — a nice structural security property.

---

## 2. Project Structure

Monorepo, three top-level directories plus the existing `knowledge/`.

```
/
├── CLAUDE.md
├── README.md
├── knowledge/                  # existing — Manager's persistent memory
├── contract/                   # the single source of truth for the API
│   ├── openapi.yaml            #   hand-maintained OpenAPI 3.1 spec
│   ├── types.ts                #   TS types, generated from openapi.yaml
│   └── fixtures/               #   shared golden JSON payloads used by BOTH sides' tests
│       ├── manifest-ready.json
│       ├── manifest-processing.json
│       └── manifest-failed.json
├── fixtures/                   # shared .obj test assets (NOT in git LFS; generated)
│   ├── generate.rs             #   synthetic fixture generator (cube, sphere, 1MB, 100MB, 600MB)
│   └── small/                  #   hand-written edge-case .obj files, committed
│       ├── cube.obj
│       ├── quads.obj
│       ├── ngon.obj
│       ├── negative-indices.obj
│       ├── no-normals.obj
│       ├── crlf.obj
│       ├── bom.obj
│       ├── degenerate-tris.obj
│       └── groups-and-materials.obj
├── backend/
└── frontend/
```

### 2.1 Backend layout

A Cargo **workspace of four crates**. I chose a workspace over a single crate specifically because multiple Workers will edit this in parallel: separate crates mean fewer merge conflicts, and they *enforce* the layering (the transcode crate physically cannot reach for `axum`, so it stays pure and testable). The cost is slightly more `Cargo.toml` ceremony, which is worth it here.

```
backend/
├── Cargo.toml                       # [workspace] members = [...], shared [workspace.dependencies]
├── Cargo.lock
├── rustfmt.toml
├── clippy.toml
├── .sqlx/                           # (only if we adopt compile-time-checked queries; see note)
└── crates/
    ├── model-core/                  # domain types + traits. NO axum, NO tokio::net, NO sqlx.
    │   └── src/
    │       ├── lib.rs
    │       ├── ids.rs               # ModelId (ULID), ShareSlug (base62 CSPRNG), UploadId
    │       ├── model.rs             # ModelRecord, ModelStatus, Bounds, MeshStats
    │       ├── lod.rs               # LodLevel, LodDescriptor, LodLadder + the ladder policy fn
    │       ├── upload.rs            # UploadSession, PartRecord, PartEtag
    │       ├── job.rs               # TranscodeJob, JobState, JobProgress
    │       ├── blob_store.rs        # trait BlobStore (async_trait)
    │       ├── metadata_store.rs    # trait MetadataStore (async_trait)
    │       ├── limits.rs            # MAX_UPLOAD_BYTES, MAX_VERTICES, MAX_FACES, chunk size
    │       └── error.rs             # CoreError (thiserror)
    │
    ├── model-transcode/             # PURE, SYNCHRONOUS, CPU-bound. The crown jewel.
    │   └── src/
    │       ├── lib.rs               # transcode(reader, sink, opts) -> TranscodeOutput
    │       ├── obj/
    │       │   ├── mod.rs
    │       │   ├── parse.rs         # tobj wrapper: pre-sizing, limits, error mapping
    │       │   └── normalize.rs     # triangulate n-gons, generate missing normals, dedup/remap
    │       ├── simplify.rs          # meshopt::simplify -> LOD ladder
    │       ├── optimize.rs          # vertex cache + vertex fetch optimization
    │       ├── quantize.rs          # positions -> i16 (with scale/offset), normals -> oct-encoded
    │       ├── glb/
    │       │   ├── mod.rs
    │       │   ├── json.rs          # gltf-json document construction
    │       │   ├── container.rs     # GLB header + JSON chunk + BIN chunk writer
    │       │   └── meshopt_ext.rs   # EXT_meshopt_compression bufferView extension emission
    │       ├── bounds.rs            # AABB + bounding sphere + suggested camera framing
    │       ├── progress.rs          # ProgressSink trait so the job runner can report %
    │       └── error.rs             # TranscodeError (user-facing vs internal variants)
    │       └── tests/               # golden-file tests against fixtures/small/*
    │
    ├── model-storage/               # concrete impls of the two core traits
    │   └── src/
    │       ├── lib.rs
    │       ├── fs_blob_store.rs     # FsBlobStore: streaming put, ranged get, multipart via part files
    │       ├── layout.rs            # key scheme: models/{id}/original.obj, models/{id}/lod{n}.glb
    │       ├── sqlite_metadata.rs   # SqliteMetadataStore
    │       ├── migrations/
    │       │   ├── 0001_init.sql
    │       │   └── 0002_upload_sessions.sql
    │       └── gc.rs                # expired-upload-session sweeper
    │
    └── model-api/                   # the binary. axum + the job runner.
        └── src/
            ├── main.rs              # config load, store wiring, router build, serve
            ├── config.rs            # env-driven Config (paths, limits, concurrency) w/ defaults
            ├── state.rs             # AppState { blob, meta, jobs, config }
            ├── error.rs             # ApiError -> IntoResponse (RFC 9457 problem+json)
            ├── dto.rs               # request/response structs, mirroring contract/openapi.yaml
            ├── routes/
            │   ├── mod.rs           # Router assembly + layer stack ordering
            │   ├── health.rs
            │   ├── uploads.rs       # POST /uploads, PUT parts, POST complete, DELETE, GET status
            │   ├── models.rs        # GET manifest, GET status SSE
            │   └── assets.rs        # GET LOD bytes: Range, ETag, immutable caching
            ├── middleware/
            │   ├── request_id.rs
            │   └── slug_redaction.rs # keeps share slugs out of access logs (they're secrets)
            └── jobs/
                ├── mod.rs
                ├── queue.rs         # bounded mpsc queue, persisted state in metadata store
                └── runner.rs        # semaphore-bounded spawn_blocking worker pool
        └── tests/
            ├── upload_flow.rs       # full initiate->parts->complete->manifest via oneshot
            ├── asset_range.rs       # Range/ETag/304 behaviour
            └── limits.rs            # oversize, bad extension, bad content, missing parts
```

**A note on `sqlx` macros:** `sqlx::query!` gives compile-time SQL checking but requires either a live `DATABASE_URL` at build time or a committed `.sqlx/` offline cache that must be regenerated whenever a query changes. That is a real friction point for parallel Workers — someone will forget to run `cargo sqlx prepare` and break the build. **Decision: use runtime `sqlx::query()` / `query_as()` with hand-written SQL.** We give up compile-time checking; we gain a build that always works. The schema is ~4 tables, so the risk is low. Note this in guidelines so nobody "improves" it later.

### 2.2 Frontend layout

Feature-folder organization, with a hard rule: `features/viewer/three/` contains **no React** and `features/viewer/components/` contains **no direct three.js resource management**. This keeps the 3D code unit-testable and keeps disposal logic in one place.

```
frontend/
├── index.html
├── package.json
├── vite.config.ts                 # dev proxy /api -> localhost:8080; wasm/worker handling
├── tsconfig.json
├── vitest.config.ts
├── playwright.config.ts
└── src/
    ├── main.tsx
    ├── App.tsx                    # Router: "/" -> UploadPage, "/v/:slug" -> ViewerPage
    ├── api/
    │   ├── client.ts              # thin fetch wrapper, problem+json error parsing
    │   ├── uploads.ts             # initiate / putPart / complete / abort / status
    │   ├── models.ts              # getManifest, subscribeStatus (SSE + poll fallback)
    │   └── types.ts               # re-export of contract/types.ts (generated)
    ├── features/
    │   ├── upload/
    │   │   ├── UploadPage.tsx
    │   │   ├── components/
    │   │   │   ├── DropZone.tsx           # drag-drop + file picker, .obj filter
    │   │   │   ├── UploadProgress.tsx     # % , MB/s, ETA, per-chunk state
    │   │   │   ├── ValidationErrors.tsx
    │   │   │   └── ShareLinkPanel.tsx     # the generated link + copy button + QR (optional)
    │   │   ├── hooks/
    │   │   │   └── useChunkedUpload.ts    # orchestrates the uploader, exposes state machine
    │   │   └── lib/
    │   │       ├── chunkedUploader.ts     # PURE logic: slicing, concurrency, retry/backoff
    │   │       ├── sha256.ts              # WebCrypto per-chunk digest
    │   │       └── validateObj.ts         # client-side pre-flight: ext, size, first-64KB sniff
    │   └── viewer/
    │       ├── ViewerPage.tsx             # orchestrates manifest -> status -> canvas
    │       ├── components/
    │       │   ├── ModelCanvas.tsx        # <Canvas frameloop="demand"> + lights + controls
    │       │   ├── ProgressiveMesh.tsx    # renders whichever LOD geometry is current
    │       │   ├── CameraRig.tsx          # OrbitControls + auto-frame from bounds
    │       │   ├── LoadingOverlay.tsx     # staged: "queued" / "processing N%" / "loading LOD"
    │       │   ├── ProcessingState.tsx    # shown while the server job runs
    │       │   ├── ErrorState.tsx
    │       │   └── StatsHud.tsx           # dev-only: tris, draw calls, FPS, current LOD
    │       ├── hooks/
    │       │   ├── useModelManifest.ts    # fetch + status subscription
    │       │   └── useProgressiveLod.ts   # THE LOD ladder state machine
    │       └── three/                     # zero React in here
    │           ├── createGltfLoader.ts    # GLTFLoader + MeshoptDecoder wiring (singleton)
    │           ├── loadLod.ts             # streaming fetch w/ progress -> parseAsync -> geometry
    │           ├── lodPolicy.ts           # device-capability -> max LOD / triangle budget
    │           ├── framing.ts             # bounds -> camera position/target/near/far
    │           └── disposal.ts            # geometry/material/renderer teardown helpers
    ├── components/                        # generic, feature-agnostic UI
    │   ├── Button.tsx
    │   ├── ProgressBar.tsx
    │   ├── CopyField.tsx
    │   └── Spinner.tsx
    ├── lib/
    │   ├── formatBytes.ts
    │   ├── deviceCapabilities.ts           # hardwareConcurrency, deviceMemory, WebGL limits
    │   └── telemetry.ts                    # perf marks: TTFP, TTFullLod (console in dev)
    └── styles/
```

---

## 3. Core Components & Responsibilities

### 3.1 Backend components

| Component | Location | Responsibility | Explicitly NOT responsible for |
|---|---|---|---|
| **HTTP layer** | `model-api/routes/` | Deserialize/validate requests, map domain errors to `problem+json`, set cache headers. Thin. | Business logic, file I/O details |
| **Upload session manager** | `model-api/routes/uploads.rs` + `model-core/upload.rs` | Create sessions, record received parts, validate size/extension/content sniff, validate part completeness on `complete`, abort/GC. | Writing bytes (delegates to `BlobStore`) |
| **`BlobStore` trait** | `model-core/blob_store.rs` | The *only* abstraction over byte storage. Streaming put, ranged get, head, delete, and S3-shaped multipart. | Knowing about models, LODs, or HTTP |
| **`FsBlobStore`** | `model-storage/fs_blob_store.rs` | Filesystem impl. Parts land as `tmp/{upload_id}/{n}.part`; `complete` concatenates (or, better, keeps parts and exposes a chained reader) into `models/{id}/original.obj`. Atomic rename on finalize. | — |
| **`MetadataStore` trait + SQLite impl** | `model-core/metadata_store.rs`, `model-storage/sqlite_metadata.rs` | Persist `models`, `share_links`, `upload_sessions`, `upload_parts`, `transcode_jobs`. Transactional state transitions. | Byte storage |
| **ID/slug generator** | `model-core/ids.rs` | ULID for internal `model_id`; 22-char base62 CSPRNG for the public `share_slug`. | — |
| **Job queue** | `model-api/jobs/queue.rs` | Bounded `mpsc` for in-process dispatch, with job rows persisted so state survives restart and a startup sweep can re-enqueue interrupted jobs. | Doing the work |
| **Job runner** | `model-api/jobs/runner.rs` | Pull job → `spawn_blocking` under a `Semaphore(N=2)` → stream original from `BlobStore` → call `model-transcode` → write LOD blobs → update status/progress → mark ready/failed. | Parsing or meshing |
| **Transcoder** | `model-transcode/` | Pure, sync, no async, no I/O beyond the `Read`/`Write` handed in. Parse → normalize → dedup → simplify ladder → optimize → quantize → GLB. Reports progress via `ProgressSink`. | Storage, HTTP, DB |
| **Manifest builder** | `model-api/routes/models.rs` | Assemble the viewer's manifest: status, bounds, camera hint, LOD descriptors with URLs/sizes/triangle counts, stats, error detail. | — |
| **Asset server** | `model-api/routes/assets.rs` | Stream LOD GLBs with `Accept-Ranges`, `Range`/`206`, strong `ETag`, `Cache-Control: public, max-age=31536000, immutable`, correct `Content-Type: model/gltf-binary`, and compression explicitly disabled. | — |

### 3.2 Frontend components

| Component | Location | Responsibility |
|---|---|---|
| **`chunkedUploader.ts`** | `features/upload/lib/` | Pure orchestration: slice the `File`, hash each chunk, drive 3 concurrent `PUT`s, retry with jittered backoff, emit progress events, support abort and (optionally) resume. No React, fully unit-testable with a fake transport. |
| **`useChunkedUpload`** | `features/upload/hooks/` | React adapter: exposes a discriminated-union state machine (`idle → validating → uploading → completing → done \| error`) plus `start`/`cancel`. |
| **`validateObj.ts`** | `features/upload/lib/` | Pre-flight before uploading 500 MB: extension check, size check, and sniff the first 64 KB for `v ` / `f ` lines. Fails fast and locally — a user who picked the wrong file learns in 50 ms, not 8 minutes. |
| **`ShareLinkPanel`** | `features/upload/components/` | Shows the link the instant `complete` returns, with a clear "still processing — the link already works" affordance. |
| **`useModelManifest`** | `features/viewer/hooks/` | Fetch the manifest; if `status` is `queued`/`processing`, subscribe to updates (SSE, with polling fallback) until terminal. |
| **`useProgressiveLod`** | `features/viewer/hooks/` | The LOD state machine: decide the target level from `lodPolicy`, load L0, expose it, then load L1…Ln in the background, hot-swapping and disposing the previous geometry. Handles cancellation on unmount and on user navigation. |
| **`loadLod.ts`** | `features/viewer/three/` | `fetch` → read `ReadableStream` with byte counting for true progress → `ArrayBuffer` → `GLTFLoader.parseAsync` → return `BufferGeometry` + stats. Never touches the DOM. |
| **`lodPolicy.ts`** | `features/viewer/three/` | Device-capability heuristic → a triangle budget and a max LOD. Prevents a phone from attempting a 10 M-triangle level. |
| **`ModelCanvas`** | `features/viewer/components/` | R3F `<Canvas frameloop="demand">`, DPR capped at 2, hemisphere + directional lighting, `OrbitControls` with damping. |
| **`CameraRig`** | `features/viewer/components/` | Frames the model from the manifest's bounds **before any geometry arrives**, so the camera never jumps when L0 lands. Sets `near`/`far` from the bounding sphere to avoid z-fighting on large-extent models. |
| **`LoadingOverlay`** | `features/viewer/components/` | Distinguishes the three waits honestly: server queued, server transcoding (`N%`), and client downloading L0 (`N%`). Users tolerate waiting; they don't tolerate not knowing which wait they're in. |

---

## 4. Data Flow

### 4.1 End-to-end diagram

```
UPLOADER'S BROWSER                    RUST BACKEND                         STORAGE
──────────────────                    ────────────                         ───────

 [1] pick file.obj (500MB)
 [2] validateObj(): ext, size,
     sniff first 64KB
         │
         ├─ POST /api/uploads ────────► create UploadSession ──────────────► (row)
         │   {filename,size,sha256?}    generate upload_id
         │◄── {upload_id, chunk_size:8MB, max_concurrency:3}
         │
 [3] File.slice() into 63 parts
     3 in flight, each:
         ├─ PUT /uploads/{id}/parts/7 ► verify X-Chunk-SHA256 ────────────► tmp/{id}/7.part
         │   (8MB body; route limit 16MB)  stream to disk, never buffered
         │◄── {etag}                       record part row
         │   ... retry w/ backoff on failure, per-part ...
         │
 [4]     ├─ POST /uploads/{id}/complete ► validate part set complete
         │   {parts:[{n,etag}...]}          finalize → models/{mid}/original.obj
         │                                  mint model_id (ULID)
         │                                  mint share_slug (22c base62 CSPRNG)
         │                                  insert transcode_job (queued)
         │◄── {share_url, slug, status:"queued"}
         │
 [5] SHOW LINK IMMEDIATELY  ◄── link is live right now, shows "processing"
                                           │
                            ══════════ BACKGROUND (spawn_blocking, Semaphore(2)) ══════════
                                           │
                                  [6] stream original.obj ◄──────────────── models/{mid}/original.obj
                                      tobj parse (pre-sized)           progress: 0-40%
                                      triangulate n-gons, gen normals
                                      generate_vertex_remap (dedup)    progress: 40-50%
                                  [7] meshopt::simplify ladder         progress: 50-80%
                                      L0 50k → L1 250k → L2 1.2M
                                      → L3 5M → L4 full
                                  [8] per level: optimize_vertex_cache,
                                      optimize_vertex_fetch,
                                      quantize (pos→i16, nrm→oct),
                                      encode_vertex/index_buffer,
                                      write GLB ────────────────────► models/{mid}/lod0..4.glb
                                                                       progress: 80-100%
                                  [9] compute bounds + camera hint
                                      write manifest fields, status=ready


VIEWER'S BROWSER (anyone with the link)
────────────────────────────────────────
[10] GET /v/{slug}  → SPA shell (cached, ~200KB)
[11] GET /api/models/{slug} → manifest
        {status:"ready", bounds, camera, lods:[...], stats}
     │
     ├─ if status != ready: show ProcessingState, subscribe to
     │  GET /api/models/{slug}/events (SSE) → progress % → re-fetch on "ready"
     │
[12] CameraRig frames from bounds  ◄── scene is interactive NOW, before any mesh
[13] lodPolicy(device) → target level (e.g. L3 desktop, L1 mobile)
[14] GET .../assets/lod0.glb  (~400KB, immutable, ranged)
        ReadableStream byte-count → progress bar
        → GLTFLoader.parseAsync → MeshoptDecoder (WASM, worker pool)
        → BufferGeometry
[15] FIRST PIXELS  ◄────────────── ~400KB transferred, not 500MB
[16] background: load L1 → compileAsync → swap → dispose L0
     background: load L2 → compileAsync → swap → dispose L1
     ... up to the policy's target level
[17] OrbitControls; frameloop="demand" → zero GPU work when idle
```

### 4.2 Per-stage detail with concrete numbers

Assuming a 500 MB `.obj` ≈ 5 M vertices / 10 M triangles:

| Stage | Bytes moved | Where the time goes | Blocking? |
|---|---|---|---|
| Upload | 500 MB up | Network-bound. ~7 min at 10 Mbps, ~40 s at 100 Mbps. | No — chunked, 3 concurrent, progress + retry |
| Server parse | 500 MB read, streamed | ~15–40 s CPU (`tobj`), peak RSS 1.5–2 GB | Runs in `spawn_blocking`; async threads untouched |
| Simplify ladder | in-memory | ~20–60 s CPU (dominated by the top levels) | Same |
| Encode + write GLB | ~65 MB written total across 5 levels | ~5–15 s | Same |
| **Manifest fetch** | ~1 KB | Single query | — |
| **LOD0 fetch + decode** | **~400 KB** | ~100 ms network + ~10 ms WASM decode | Decode is off-thread |
| LOD3 fetch + decode | ~30 MB | Background; user is already interacting | Off-thread |
| Full LOD4 fetch | ~65 MB | Background, desktop only | Off-thread |

Estimated encoded sizes (meshopt + quantization): positions at 16-bit/component ≈ 6 B/vert, octahedral normals ≈ 4 B/vert, indices ≈ 1–2 B/tri after `encode_index_buffer`. So the full level lands at roughly `5M × 10 B + 10M × 1.5 B ≈ 65 MB`, and L0 at 50 k triangles is around 400 KB. **That is the headline: ~400 KB to first render instead of 500 MB.**

### 4.3 Identifiers and the shareable link

Two distinct IDs, and the distinction is a security requirement, not aesthetics:

| ID | Form | Where it appears | Why |
|---|---|---|---|
| `model_id` | ULID (26 chars, lexicographically sortable) | Internal only — DB keys, storage paths, logs | Sortable IDs give good index locality; never exposed, so it can't be enumerated |
| `share_slug` | 22 chars base62 from `rand`'s CSPRNG (~131 bits) | The public URL: `/v/{slug}` | **This slug IS the access credential.** With no auth in scope, unguessability is the entire security model |

Consequences of "the URL is the credential", which must be implemented, not just noted:
- Generate slugs from a **cryptographically secure** RNG. Never from a hash of the filename, a timestamp, or a counter.
- ~131 bits of entropy makes enumeration infeasible.
- Set `Referrer-Policy: no-referrer` on the viewer page so the slug doesn't leak to third parties via `Referer`.
- **Keep slugs out of access logs** — hence the `slug_redaction` middleware. A log aggregator full of live credentials is a real incident waiting to happen.
- Store slugs in a **separate `share_links` table** keyed to `model_id`. That is what makes future revocation, expiry, and multiple-links-per-model additive rather than a migration.

### 4.4 Client-side processing: what happens in the browser, and what doesn't

| Work | Where | Why |
|---|---|---|
| `.obj` parsing | **Server, once** | 20–50 s and 2–3 GB in JS, repeated per viewer. Non-negotiable. |
| Mesh simplification / LOD | **Server, once** | CPU-heavy; results are shared by every viewer. |
| Compression/quantization | **Server, once** | — |
| meshopt *decode* | Client, WASM, worker pool | ~1 GB/s; effectively free |
| glTF JSON parse + `BufferGeometry` assembly | Client, via `parseAsync` | Small; yielded so it doesn't janks the frame |
| Bounds / camera framing | **Server** computes, client consumes | Lets us frame the camera before geometry arrives |
| Rendering | Client, GPU | Obviously |

Note that there is a **single code path** — small files go through exactly the same transcode pipeline, where it completes in well under a second. I deliberately rejected a "small file client-side fast path": two code paths for one feature is a permanent maintenance and bug-surface tax for a negligible latency win.

### 4.5 API surface

| Method | Path | Request | Response | Notes |
|---|---|---|---|---|
| `POST` | `/api/uploads` | `{filename, size_bytes, content_type?, client_sha256?}` | `{upload_id, chunk_size, max_concurrency, expires_at}` | Rejects size > 500 MB and bad extension up front |
| `PUT` | `/api/uploads/{id}/parts/{n}` | raw bytes, `X-Chunk-SHA256` | `{part_number, etag, size}` | Route body limit 16 MB; streamed to disk |
| `GET` | `/api/uploads/{id}` | — | `{status, received_parts:[n], bytes_received, expires_at}` | Enables resume |
| `POST` | `/api/uploads/{id}/complete` | `{parts:[{n, etag}]}` | `{model_id, share_slug, share_url, status:"queued"}` | Validates the part set is complete and contiguous |
| `DELETE` | `/api/uploads/{id}` | — | `204` | Abort; deletes temp parts |
| `GET` | `/api/models/{slug}` | — | Manifest (see below) | The viewer's single entry point |
| `GET` | `/api/models/{slug}/events` | — | `text/event-stream` | Status/progress while transcoding; polling fallback if unsupported |
| `GET` | `/api/models/{slug}/assets/{asset}` | `Range?`, `If-None-Match?` | GLB bytes | `206`/`304` support, `immutable` caching, compression off |
| `GET` | `/api/models/{slug}/original` | — | `.obj` bytes | Optional (see open question 8) |
| `GET` | `/healthz` | — | `{status, version}` | — |

Manifest shape (the contract both sides are written against):

```json
{
  "slug": "7Kq2mV9pLx4RtZ0aBcDeFg",
  "status": "ready",
  "filename": "scan.obj",
  "created_at": "2026-09-21T10:00:00Z",
  "progress": { "stage": "done", "percent": 100 },
  "error": null,
  "stats": { "source_bytes": 524288000, "vertices": 5013442, "triangles": 9982117 },
  "bounds": {
    "min": [-12.5, 0.0, -8.3], "max": [12.5, 40.1, 8.3],
    "center": [0.0, 20.05, 0.0], "radius": 24.2
  },
  "camera": { "position": [40.0, 30.0, 40.0], "target": [0.0, 20.05, 0.0], "near": 0.24, "far": 242.0 },
  "lods": [
    { "level": 0, "url": "/api/models/{slug}/assets/lod0.glb", "triangles": 50000,   "byte_length": 412000 },
    { "level": 1, "url": "...lod1.glb", "triangles": 250000,  "byte_length": 1900000 },
    { "level": 2, "url": "...lod2.glb", "triangles": 1200000, "byte_length": 8600000 },
    { "level": 3, "url": "...lod3.glb", "triangles": 5000000, "byte_length": 33000000 },
    { "level": 4, "url": "...lod4.glb", "triangles": 9982117, "byte_length": 65000000 }
  ]
}
```

While `status` is `queued` or `processing`, `lods` is `[]`, `bounds`/`camera` may be `null`, and `progress` carries a stage label plus a percentage. Errors use RFC 9457 `application/problem+json` with a stable `type` URI so the frontend can branch on machine-readable codes rather than message strings.

---

## 5. How the Plan Specifically Addresses "Large Files"

Collecting the mechanisms in one place, since this was called out as a requirement:

| Concern | Mechanism | Where |
|---|---|---|
| 500 MB upload without memory blowup | Chunked 8 MB parts streamed straight to storage; server body limit is 16 MB, never 500 MB | `routes/uploads.rs`, `FsBlobStore` |
| Upload reliability over minutes | Per-chunk retry with jittered exponential backoff; 3 concurrent; per-chunk SHA-256 integrity | `chunkedUploader.ts` |
| Upload progress honesty | Real byte counts per chunk → aggregate %, MB/s, ETA | `UploadProgress.tsx` |
| Never ship 500 MB of ASCII to a browser | Server-side transcode to meshopt GLB | `model-transcode` |
| Time-to-first-pixel | LOD ladder; L0 is ~400 KB and renders in well under a second | `simplify.rs` + `useProgressiveLod` |
| Progressive refinement | Background load of L1..Ln with hot swap and disposal | `useProgressiveLod`, `disposal.ts` |
| No visible hitch on LOD swap | Build geometry off-thread, `renderer.compileAsync()` to force shader/VBO upload, *then* swap visibility, *then* dispose the old level | `ProgressiveMesh.tsx` |
| Main thread never blocks | meshopt decode in WASM worker pool; `GLTFLoader.parseAsync`; streaming `fetch` reader | `createGltfLoader.ts`, `loadLod.ts` |
| GPU memory bounded | Hold at most current + incoming LOD; dispose immediately after swap | `disposal.ts` |
| Weak devices don't attempt 10 M triangles | `lodPolicy` triangle budget from `hardwareConcurrency` / `deviceMemory` / WebGL limits | `lodPolicy.ts` |
| Idle CPU/GPU cost is zero | R3F `frameloop="demand"` — render only on camera change | `ModelCanvas.tsx` |
| Camera correct before geometry arrives | Server-computed bounds + camera hint in the manifest | `bounds.rs`, `CameraRig.tsx` |
| Repeat visits are instant | `Cache-Control: immutable` + strong `ETag` on per-model-immutable assets | `routes/assets.rs` |
| Interrupted LOD download resumes | `Accept-Ranges` / `Range` / `206` on asset routes | `routes/assets.rs` |
| Wasted CPU on already-compressed bytes | `CompressionLayer` predicate excludes `model/gltf-binary` | `routes/mod.rs` |
| Transcode doesn't starve the server | `spawn_blocking` under `Semaphore(2)`; bounded job queue with backpressure | `jobs/runner.rs` |
| 500 MB upload isn't wasted on a restart | Job rows persisted; startup sweep re-enqueues interrupted jobs | `jobs/queue.rs` |
| Parse bombs / pathological inputs | Hard caps on vertices/faces; content sniff; clear user-facing failure | `limits.rs`, `obj/parse.rs` |
| Culling actually helps (Phase 2) | Octree-chunk the top LOD into ~150 k-triangle meshes so frustum culling has something to cull | §8 |

One thing worth stating plainly: for a single 10 M-triangle mesh, **frustum culling does nothing** — it's one draw call, either in or out. This is why spatial chunking is on the Phase-2 list. The LOD ladder is the Phase-1 win and is much larger.

---

## 6. Worker Breakdown

### 6.1 Jobs and phasing

Six jobs. Concurrency limits are per job (max 1 Senior + 1 Middle + 3 Junior active), so this grouping is chosen to let four jobs run in parallel during the main build without ever breaking the global cap of 10.

| Job | Name | Phase | Depends on |
|---|---|---|---|
| **J0** | Contract & Scaffolding | Phase 0 (serial, first) | — |
| **J1** | Backend Core & Storage | Phase 1 | J0 |
| **J2** | Transcode Pipeline | Phase 1 | J0 (+ B0-2 spike) |
| **J3** | Frontend Shell & Upload | Phase 1 | J0 |
| **J4** | Frontend Viewer | Phase 1 | J0 |
| **J5** | Integration, Perf & Hardening | Phase 2–3 | J1–J4 |

**Critical sequencing advice: build the walking skeleton first.** Before any optimization work, get a **1 MB cube** all the way through: upload → transcode → manifest → render. Every subsequent task then has a working end-to-end path to test against, and integration surprises surface on day one instead of at the end. Task **J5-1** is explicitly this milestone and should be reached as early as possible.

**Recommended concurrency during Phase 1** (8 active, under the cap of 10):

| Job | Senior | Middle | Junior |
|---|---|---|---|
| J1 | 1 | 1 | 0–1 |
| J2 | 1 | 1 | 0 |
| J3 | 0 | 1 | 1 |
| J4 | 1 | 1 | 0 |

### 6.2 Job 0 — Contract & Scaffolding (Phase 0, mostly serial)

| ID | Task | Level | Deps | Done when |
|---|---|---|---|---|
| **B0-1** | Author `contract/openapi.yaml` covering every endpoint in §4.5, the manifest schema, and the `problem+json` error catalogue with stable `type` URIs. | **Senior** | — | Spec validates; all response shapes and error codes enumerated; reviewed by Manager |
| **B0-2** | **Dependency + memory spike.** Pin exact versions of `axum`, `tobj`, `meshopt`, `gltf-json`, `sqlx`, `three`, `@react-three/fiber`, `meshoptimizer`. Verify the actual `meshopt` crate API surface (`simplify`, `generate_vertex_remap`, `encode_vertex_buffer`, `encode_index_buffer`) and `gltf-json`'s document builder. Generate a synthetic 500 MB `.obj` and measure `tobj` wall time and **peak RSS**. | **Senior** | — | A short report: pinned versions, confirmed signatures, measured parse time and peak RSS, and a go/no-go on `tobj` vs. the streaming-parser contingency (B1-7) |
| **B0-3** | Generate `contract/types.ts` from the OpenAPI spec; wire the generation into an npm script. | Junior | B0-1 | `npm run gen:types` reproduces the file; TS compiles |
| **B0-4** | Author `contract/fixtures/*.json` — golden manifest payloads for ready/processing/failed. | Junior | B0-1 | Fixtures validate against the spec and are imported by both backends' and frontend's tests |
| **B0-5** | Scaffold the Cargo workspace: 4 crates, shared `[workspace.dependencies]`, `rustfmt.toml`, `clippy.toml` (deny warnings), a `hello` binary that serves `/healthz`. | Middle | B0-2 | `cargo build --workspace`, `cargo clippy`, `cargo test` all clean |
| **B0-6** | Scaffold the Vite + React + TS frontend: routing, dev proxy to `:8080`, Vitest, Playwright config, WASM/worker handling in `vite.config.ts`. | Middle | B0-2 | `npm run dev`, `build`, `test`, `lint` all work; both routes render placeholders |
| **B0-7** | Author the `.obj` edge-case fixtures in `fixtures/small/` (cube, quads, n-gons, negative indices, no normals, CRLF, BOM, degenerate triangles, groups+materials) and the `fixtures/generate.rs` synthetic generator. | Middle | — | 9 hand-written fixtures committed; generator produces 1 MB / 100 MB / 600 MB files on demand |
| **B0-8** | Write `knowledge/guidelines.md` entries for this project: error-handling conventions, the "runtime `sqlx` queries, not macros" decision, the no-React-in-`three/` rule, the "slugs are secrets — never log them" rule. | Junior | B0-1 | Committed |

### 6.3 Job 1 — Backend Core & Storage

| ID | Task | Level | Deps | Done when |
|---|---|---|---|---|
| **B1-1** | `model-core`: all domain types (`ModelId`, `ShareSlug`, `UploadId`, `ModelRecord`, `ModelStatus`, `Bounds`, `MeshStats`, `LodDescriptor`, `UploadSession`, `TranscodeJob`), plus the `BlobStore` and `MetadataStore` traits and `limits.rs`. | **Senior** | B0-5 | Compiles with no deps on axum/sqlx; traits reviewed as the stable seam between J1 and J2 |
| **B1-2** | `ids.rs`: ULID `ModelId`; 22-char base62 `ShareSlug` from a CSPRNG. Include a test asserting the slug alphabet is URL-safe and a statistical smoke test for distribution. | Middle | B1-1 | Tests pass; no `SmallRng`/`thread_rng`-without-CSPRNG anywhere |
| **B1-3** | `FsBlobStore`: streaming `put`, ranged `get`, `head`, `delete`, and S3-shaped multipart (`create` / `put_part` / `complete` / `abort`). Atomic finalize via temp-file + rename. Path traversal defenses on every key. | **Senior** | B1-1 | Integration tests cover multipart round-trip, ranged reads, abort cleanup, and a traversal attempt (`../`) being rejected |
| **B1-4** | SQLite schema migrations: `models`, `share_links`, `upload_sessions`, `upload_parts`, `transcode_jobs`. Indices on `share_links.slug` (unique), `transcode_jobs.state`, `upload_sessions.expires_at`. | Middle | B1-1 | Migrations apply cleanly from empty; schema reviewed |
| **B1-5** | `SqliteMetadataStore`: implement `MetadataStore` with runtime `sqlx::query`. Transactional `complete_upload` (finalize session + insert model + insert share link + enqueue job, atomically). | **Senior** | B1-4 | Tests cover every state transition; the `complete_upload` transaction is verified to roll back fully on failure |
| **B1-6** | `gc.rs`: sweeper for expired upload sessions (delete temp parts + rows); runs on an interval and at startup. | Middle | B1-3, B1-5 | Test proves expired sessions are cleaned and live ones are not |
| **B1-7** | **CONTINGENCY — only if B0-2 says `tobj` peak RSS is unacceptable.** Hand-written two-pass streaming `.obj` parser: pass 1 counts elements to size buffers exactly, pass 2 fills them without retaining the source text. | **Senior** | B0-2 | Passes the full `fixtures/small/` suite identically to `tobj`; peak RSS under 600 MB for a 500 MB input |

### 6.4 Job 2 — Transcode Pipeline

| ID | Task | Level | Deps | Done when |
|---|---|---|---|---|
| **B2-1** | `obj/parse.rs`: `tobj` wrapper with `Vec` pre-sizing from file length, the vertex/face hard caps from `limits.rs`, and error mapping that distinguishes user-fixable problems from internal faults. | **Senior** | B1-1, B0-7 | All 9 fixtures parse to expected counts; oversize input fails with a clean user-facing error |
| **B2-2** | `obj/normalize.rs`: fan-triangulate n-gons, skip degenerate triangles, generate angle-weighted smooth normals when absent, and run `generate_vertex_remap` for dedup. | **Senior** | B2-1 | Golden tests: quads→2 tris, 5-gon→3 tris, `no-normals.obj` produces unit-length plausible normals, dedup reduces the known-duplicate fixture |
| **B2-3** | `bounds.rs`: AABB, bounding sphere, and the suggested camera position/target/near/far. | Middle | B2-1 | Unit tests on the cube fixture give exact expected values; near/far are sane across 4 orders of magnitude of model scale |
| **B2-4** | `simplify.rs`: build the LOD ladder via `meshopt::simplify`. Ladder policy: target ~5× reduction per level, L0 ≈ 50 k triangles, stop when a level is within 1.5× of the source. Skip levels for small inputs. | **Senior** | B2-2 | A 10 M-tri synthetic input yields the expected 5-level ladder; a 5 k-tri input yields exactly 1 level; every level is watertight enough to render |
| **B2-5** | `optimize.rs`: `optimize_vertex_cache` then `optimize_vertex_fetch` per level. | Middle | B2-4 | ACMR measured to improve versus unoptimized; indices remain valid |
| **B2-6** | `quantize.rs`: positions → `i16` with per-model scale/offset (folded into the glTF node transform), normals → octahedral, UVs → normalized `u16`. | **Senior** | B2-5 | Round-trip error below a documented tolerance; visual diff on a sphere fixture shows no artifacts |
| **B2-7** | `glb/json.rs` + `glb/container.rs`: build the glTF JSON document and write the GLB container (12-byte header, padded JSON chunk, BIN chunk). | **Senior** | B2-6 | Output opens in an independent glTF viewer and passes the Khronos validator |
| **B2-8** | `glb/meshopt_ext.rs`: emit `EXT_meshopt_compression` buffer-view extensions with correct `mode`/`filter`/`count`/`byteStride`, and list it in `extensionsRequired`. | **Senior** | B2-7 | A GLB produced here loads in three.js with `MeshoptDecoder` and renders correctly — this is the single most important interop checkpoint in the project |
| **B2-9** | `progress.rs`: `ProgressSink` trait; instrument the pipeline with the stage weights from §4.1 (parse 0–40, dedup 40–50, simplify 50–80, encode 80–100). | Junior | B2-1..B2-8 | Progress is monotonic and reaches 100 |
| **B2-10** | Top-level `transcode()`: wire the stages, own the error taxonomy, add `tracing` spans with per-stage timings. | **Senior** | B2-1..B2-9 | End-to-end test: `cube.obj` in → valid GLB ladder out; `#[ignore]`-gated test on the 100 MB fixture records stage timings |
| **B2-11** | Golden-file test suite across all `fixtures/small/` inputs, asserting triangle counts, bounds, and GLB validity per level. | Middle | B2-10 | `cargo test -p model-transcode` is green and fast (< 10 s) |

### 6.5 Job 3 — Frontend Shell & Upload

| ID | Task | Level | Deps | Done when |
|---|---|---|---|---|
| **F3-1** | `api/client.ts`: fetch wrapper with `problem+json` parsing into typed errors, timeouts, and abort support. | Middle | B0-3 | Unit tests via MSW cover success, 4xx problem payloads, 5xx, and abort |
| **F3-2** | `validateObj.ts`: extension, size, and first-64 KB content sniff. | Middle | B0-6 | Tests: valid `.obj` passes; `.stl` renamed to `.obj` is rejected; a 501 MB file is rejected without reading it all |
| **F3-3** | `chunkedUploader.ts`: pure orchestration — slicing, per-chunk SHA-256 via WebCrypto, 3-way concurrency, jittered exponential backoff (5 attempts), progress events, abort. Injectable transport for testing. | **Senior** | F3-1 | Unit tests with a fake transport cover: happy path, one chunk failing twice then succeeding, permanent failure aborting cleanly, and mid-flight cancellation |
| **F3-4** | `useChunkedUpload`: React adapter exposing a discriminated-union state machine + `start`/`cancel`. | Middle | F3-3 | Hook tests cover every state transition |
| **F3-5** | `DropZone.tsx`: drag-and-drop plus file picker, `.obj` filter, keyboard accessible. | Middle | F3-2 | Works via both drop and picker; a11y checks pass |
| **F3-6** | `UploadProgress.tsx`: percentage, MB/s, ETA, chunk-level detail, cancel button. | Middle | F3-4 | Renders correctly against mocked progress event streams |
| **F3-7** | `ShareLinkPanel.tsx`: the link plus copy-to-clipboard, with clear "processing — the link already works" messaging. | Junior | F3-4 | Copy works; the processing affordance is unambiguous |
| **F3-8** | Generic UI components: `Button`, `ProgressBar`, `CopyField`, `Spinner`. | Junior | B0-6 | Rendered in a simple gallery route; consistent styling |
| **F3-9** | `formatBytes.ts`, `deviceCapabilities.ts`, `telemetry.ts`. | Junior | B0-6 | Unit tested; telemetry emits `TTFP` / `TTFullLod` marks in dev |
| **F3-10** | `UploadPage.tsx`: compose the flow end to end, including error states. | Middle | F3-2..F3-8 | Full flow works against MSW mocks |

### 6.6 Job 4 — Frontend Viewer

| ID | Task | Level | Deps | Done when |
|---|---|---|---|---|
| **F4-1** | `createGltfLoader.ts`: singleton `GLTFLoader` with `MeshoptDecoder` wired in; verify the WASM asset resolves correctly under Vite in both dev and build. | **Senior** | B0-6 | A GLB from B2-8 loads and renders in a scratch route; no COOP/COEP headers required (confirm this — we do not want cross-origin-isolation constraints) |
| **F4-2** | `loadLod.ts`: streaming `fetch` with `ReadableStream` byte counting for true progress → `ArrayBuffer` → `parseAsync` → `{geometry, stats}`. Abortable. | **Senior** | F4-1 | Progress callbacks fire with real byte counts; abort mid-download leaks nothing |
| **F4-3** | `framing.ts`: manifest bounds → camera position/target/near/far, with sane behaviour across extreme model scales. | Middle | B0-4 | Unit tests over tiny, huge, and extremely elongated bounds |
| **F4-4** | `lodPolicy.ts`: device capability → triangle budget → max LOD level. | **Senior** | F3-9 | Documented heuristic with tests for desktop/mobile/low-memory profiles; a phone profile never selects the top level |
| **F4-5** | `disposal.ts`: geometry/material/renderer teardown helpers. | Middle | F4-1 | A test loading and disposing 10 LODs in sequence shows no growth in `renderer.info.memory` |
| **F4-6** | `useProgressiveLod`: the LOD state machine — load L0, expose it, then background-load upward to the policy target, hot-swapping and disposing. Cancel on unmount. | **Senior** | F4-2, F4-4, F4-5 | Tests with mocked loaders verify ordering, swap correctness, disposal of superseded levels, and clean cancellation |
| **F4-7** | `ModelCanvas.tsx`: R3F `<Canvas frameloop="demand">`, DPR capped at 2, hemisphere + directional lighting, `OrbitControls` with damping. | Middle | F4-1 | Idle frame count confirmed to be zero when the camera is still |
| **F4-8** | `ProgressiveMesh.tsx`: render the current geometry; on swap, add the incoming mesh hidden, `renderer.compileAsync()`, then swap visibility and dispose the outgoing level. | **Senior** | F4-6, F4-7 | An LOD swap is visually seamless — no flash, no frame-time spike beyond a documented budget |
| **F4-9** | `CameraRig.tsx`: frame from manifest bounds before geometry arrives; `OrbitControls` tuned (damping, zoom limits from bounding radius, pan clamping). | Middle | F4-3, F4-7 | Camera does not move when L0 lands; orbit/zoom feel good on the test models |
| **F4-10** | `useModelManifest`: fetch, plus SSE subscription with polling fallback until terminal status. | Middle | F3-1, B0-4 | Tests against all three golden fixtures; SSE-unsupported path falls back to polling |
| **F4-11** | `ProcessingState.tsx`, `LoadingOverlay.tsx`, `ErrorState.tsx`: distinguish server-queued / server-transcoding-N% / client-downloading-N%, and render each error `type` usefully. | Middle | F4-10 | All states reachable and correct against mocks |
| **F4-12** | `StatsHud.tsx`: dev-only overlay — triangles, draw calls, FPS, current LOD, bytes transferred. | Junior | F4-7 | Visible under a dev flag, tree-shaken from production builds |
| **F4-13** | `ViewerPage.tsx`: compose manifest → status → canvas → LOD pipeline, including all error and empty states. | **Senior** | F4-6..F4-12 | Full viewer works against MSW mocks plus a real GLB fixture |

### 6.7 Job 5 — Integration, Perf & Hardening

| ID | Task | Level | Deps | Done when |
|---|---|---|---|---|
| **B5-1** | `model-api` routes for uploads: initiate, put-part, status, complete, abort. Per-route 16 MB body limit; streamed part bodies. | **Senior** | B1-3, B1-5 | Integration tests via `oneshot` cover the whole flow plus every rejection path |
| **B5-2** | Job queue + runner: bounded `mpsc`, persisted job rows, `Semaphore(2)` `spawn_blocking` pool, progress updates, startup re-enqueue of interrupted jobs. | **Senior** | B1-5, B2-10 | Test: enqueue 5 jobs, assert max 2 concurrent; kill and restart mid-job and assert it resumes |
| **B5-3** | `routes/models.rs`: manifest endpoint + SSE status stream. | Middle | B1-5, B5-2 | Manifest matches the golden fixtures byte-for-byte in shape; SSE emits progress and terminates on `ready` |
| **B5-4** | `routes/assets.rs`: `Range`/`206`, strong `ETag`/`304`, `immutable` caching, `model/gltf-binary`, compression predicate excluding GLB. | **Senior** | B1-3 | Tests cover `206` partial, `304`, unsatisfiable range → `416`, and confirm GLB responses are not gzipped |
| **B5-5** | `error.rs`: `ApiError` → RFC 9457 `problem+json`, with the stable `type` URIs from the contract. | Middle | B0-1 | Every error variant round-trips to the documented shape |
| **B5-6** | Middleware: request IDs, tracing, CORS, timeouts, and `slug_redaction` so share slugs never reach access logs. | Middle | B5-1 | A test asserts no slug appears in captured log output |
| **B5-7** | `main.rs` + `config.rs`: env-driven config with working defaults, store wiring, graceful shutdown. | Middle | B5-1..B5-6 | `cargo run` with zero env vars starts a working server against a local data directory |
| **B5-8** | **Walking-skeleton milestone.** Drive a 1 MB cube through the real stack end to end: upload → transcode → manifest → render in a real browser. | **Senior** | B5-7, F4-13 | A cube is visible and orbitable in Chrome, served by the real backend. **Reach this as early as possible.** |
| **B5-9** | Playwright E2E: upload a small `.obj`, wait for ready, open the share link in a fresh context, assert the canvas renders (WebGL via SwiftShader/ANGLE). | **Senior** | B5-8 | Green in headless CI-like conditions |
| **B5-10** | Perf validation on the 500 MB fixture: record upload duration, transcode wall time, peak RSS, LOD byte sizes, time-to-first-pixel, and time-to-target-LOD. Compare against the §4.2 estimates. | **Senior** | B5-8 | A measurements table; any estimate off by more than 2× is flagged back to me for plan revision |
| **B5-11** | Limits and abuse hardening: oversize rejection, extension + content sniff, vertex/face caps, parse-bomb defense, upload session expiry, bounded queue returning `503` when saturated. | **Senior** | B5-1, B2-1 | Negative-path test suite is green |
| **B5-12** | Wire the GC sweeper into the server lifecycle. | Junior | B1-6, B5-7 | Temp parts from abandoned uploads disappear after the expiry window |
| **B5-13** | `README.md`: how to run backend and frontend, how to generate fixtures, the architecture summary, and the LOD/format rationale. | Junior | B5-8 | A newcomer can get the stack running from the README alone |

### 6.8 Task count by level

| Level | Count | Share |
|---|---|---|
| Senior | 25 | 43% |
| Middle | 23 | 40% |
| Junior | 10 | 17% |

The Senior share is high, which is correct for this project: the transcode pipeline, the GLB/meshopt interop, the chunked uploader, and the LOD state machine are all novel, architecture-sensitive work with real research content. Do not downgrade **B2-4**, **B2-6**, **B2-7**, **B2-8**, **F3-3**, **F4-2**, **F4-6**, or **F4-8** — those are the tasks where a wrong call is expensive to unwind.

---

## 7. Testing Strategy

| Layer | Tooling | Coverage target |
|---|---|---|
| `model-transcode` units | `#[test]` + golden files | Every `fixtures/small/` case; exact triangle counts and bounds |
| Parser robustness | `proptest` | Index remapping and triangulation never panic and never emit out-of-range indices |
| `model-storage` | integration tests on a temp dir | Multipart round-trip, ranged reads, abort cleanup, path traversal rejection |
| `model-api` | `tower::ServiceExt::oneshot` | Full upload flow in-process, no network; every error path |
| Large-file behaviour | `#[ignore]`-gated tests | 100 MB perf smoke; 600 MB rejection |
| Frontend units | Vitest | `chunkedUploader` with a fake transport; `lodPolicy`; `framing`; `disposal` |
| Frontend API layer | MSW + golden fixtures from `contract/fixtures/` | All three manifest states plus every error `type` |
| E2E | Playwright | Upload → ready → open link in a fresh context → canvas renders |
| Interop checkpoint | Manual + Khronos validator | GLBs from B2-8 load in three.js **and** in an independent glTF viewer |

The `contract/fixtures/` directory is deliberately shared by both sides' tests. That is what keeps the frontend and backend from drifting while they are built in parallel against a mock.

---

## 8. Deliberate Non-Goals and the Phase-2+ Evolution Path

Things I considered and consciously deferred, with the seam that keeps each one cheap to add later:

| Deferred | Seam that keeps it cheap |
|---|---|
| **Spatial chunking** (octree-bucket the top LOD into ~150 k-tri meshes so frustum culling helps, and so we can stream view-dependently) | The manifest's `lods` array can gain a `chunks` array without breaking the viewer; `useProgressiveLod` already owns swap/disposal |
| **View-dependent streaming / 3D Tiles** | Same manifest extension point; would supersede the flat ladder |
| **`.mtl` + textures** | GLB already carries materials and textures; only `model-transcode`'s front-end changes |
| **Other formats (`.stl`, `.ply`, `.fbx`, `.gltf`)** | `obj/` is one module behind a `parse → NormalizedMesh` seam; add siblings |
| **Object storage (S3/GCS)** | `BlobStore` trait, with multipart methods already S3-shaped; later, presigned part URLs let bytes bypass our server entirely |
| **Postgres** | `MetadataStore` trait + `sqlx` |
| **Out-of-process job workers** | Job rows are already persisted; swap the in-process `mpsc` for a real queue |
| **Auth / ownership / revocation** | `share_links` is already a separate table keyed to `model_id` |
| **WebGPU renderer** | three.js `WebGPURenderer` behind a capability check; format is unaffected |
| **Screen-space post-processing, shadows, IBL** | Additive inside `ModelCanvas` |

---

## 9. Open Questions for the User

These do **not** block the start of work — Phase 0 and most of Phase 1 proceed regardless — but each one has a default I've assumed, and confirming or overriding them early avoids rework.

| # | Question | My assumed default | Why it matters / when it's needed |
|---|---|---|---|
| 1 | **Is "the link works immediately but shows a processing state" acceptable, versus withholding the link until the model is ready?** | Link is live immediately, shows progress | This is the most user-visible architectural consequence. For 500 MB files, transcode is 40 s–2 min, so withholding the link means a long blank wait after an already-long upload. Affects F3-7 and F4-11. |
| 2 | **Resumable-after-page-refresh uploads?** | Not in v1 — retry within a session only | The server already reports received parts, so the *server* side is free. The client side needs `IndexedDB` persistence of `{upload_id, file handle, part state}`, and browsers won't re-grant access to a `File` after refresh without the File System Access API. Roughly a 1-day Senior task. Say the word and I'll add it to J3. |
| 3 | **Unguessable-link-only privacy is the entire access model. Confirm that's acceptable.** | Yes, per "auth out of scope" | Anyone with the URL sees the model, forever. I've made the slug 131 bits and kept it out of logs, but if these models are sensitive, we should at least add expiry (cheap now, since `share_links` is already its own table). |
| 4 | **Retention: do models live forever? Any quota or expiry?** | Forever; no quota | 500 MB per upload plus ~65 MB of derived assets adds up fast. If you want TTL, tell me now — it's a column and a sweeper, versus a migration later. |
| 5 | **Top-LOD triangle cap for delivery?** | Deliver the full mesh as the top level, but `lodPolicy` won't select it on weak devices | If you'd rather hard-cap delivery at, say, 5 M triangles and keep the original only as a download, that changes B2-4's ladder policy. |
| 6 | **Keep the original `.obj` and offer it for download?** | Keep it, expose `GET /original` | Storage cost roughly doubles. Keeping it is what lets us re-transcode with better settings later without asking users to re-upload — I'd strongly prefer to keep it even if we don't expose the download. |
| 7 | **SSE for status, or plain polling?** | SSE with a polling fallback | SSE holds a connection per waiting viewer. Polling every 2 s is simpler and perfectly adequate. If you want to cut scope, drop SSE — it's a small delta in F4-10 and B5-3. |
| 8 | **Single-process, in-memory job queue acceptable for now?** | Yes — jobs are persisted, so restarts recover, but there's only one server process | Means no horizontal scaling until we swap in a real queue. Consistent with "no infra decisions", and the seam is in place. |
| 9 | **Mobile browser support: target or best-effort?** | Best-effort — `lodPolicy` picks a conservative level; uploading 500 MB from a phone is not a supported flow | Affects how much time F4-4 gets and whether B5-9 includes a mobile Playwright project. |
| 10 | **Accept pre-compressed uploads (`.obj.gz`)?** | No, v1 is plain `.obj` | Would cut upload time ~5–8× for text, which is a large UX win. But it needs decompression-bomb defense (enforce a limit on the *decompressed* stream, not the declared size). Half a day, Senior. Worth considering. |
| 11 | **Draco instead of meshopt if visual fidelity at low bitrate matters more than decode speed?** | meshopt | Draco compresses ~25% better but decodes 5–10× slower. For our LOD-first strategy, decode latency matters more than the last 25%. Flag it if your source models are unusually quantization-sensitive. |
| 12 | **Point clouds and polylines in `.obj` (`p` / `l` elements)?** | Ignored — triangles only | Some scanner exports are point-only, and those would currently produce an empty model. If that's a real input, we need a point-cloud render path, which is a meaningful addition to both J2 and J4. |
| 13 | **Is `500 MB` the raw file size limit, or should it be a limit on mesh complexity?** | Raw bytes, plus independent vertex/face caps | A 500 MB `.obj` with 6-decimal coordinates has far fewer triangles than one with 2-decimal coordinates, so bytes are a loose proxy for cost. I've added explicit complexity caps in `limits.rs` for this reason; confirm the numbers with me once B0-2 reports real timings. |
| 14 | **OpenAPI spec hand-maintained, or generated from Rust types?** | Hand-maintained as the source of truth, with TS types generated from it | Hand-maintaining means it can drift from the Rust code. Generating from Rust (`utoipa`) prevents drift but makes the spec a downstream artifact, which is awkward when the frontend is built in parallel against a mock. I chose contract-first for the parallelism. |
| 15 | **Any preference on styling approach?** | Plain CSS modules — the UI is genuinely tiny (one upload page, one viewer) | If you want Tailwind or a component library, say so before F3-8 starts, since retrofitting is annoying. |

---

## 10. Immediate Next Actions for the Manager

1. **Spawn two Senior Workers on Job 0 now, in parallel:** one on **B0-1** (OpenAPI contract), one on **B0-2** (dependency + memory spike). These two unblock everything else and are independent of each other.
2. **Treat B0-2's report as a gate.** If `tobj`'s peak RSS exceeds roughly 2 GB on the 500 MB fixture, or if the `meshopt`/`gltf-json` APIs have drifted from what §1.2 assumes, **feed that back to me before Phase 1 starts** — B1-7 exists precisely for that branch, and I may want to revise the ladder policy too.
3. Once B0-1 lands, run **B0-3/B0-4** (Junior) and **B0-5/B0-6/B0-7** (Middle) to get both scaffolds and all fixtures in place.
4. **Then open Phase 1 with the four-job parallel layout from §6.1** (8 active Workers, under the global cap of 10).
5. **Push hard on reaching B5-8 (the walking skeleton) early** — even with stub implementations behind it. Every integration risk in this plan surfaces at that milestone, and I'd rather it surface in week one.
6. **Report back to me** after B0-2 and again after B5-10 (the 500 MB perf validation). Those are the two points where real measurements could change the architecture; everything in between should just execute.

Relevant paths referenced in this plan, all under `/Users/schaf.run/ClaudedProjects/archi-project-template/`: `contract/openapi.yaml`, `fixtures/small/`, `backend/crates/{model-core,model-transcode,model-storage,model-api}/`, `frontend/src/features/{upload,viewer}/`.
