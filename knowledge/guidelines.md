# Project Guidelines

Standing conventions and decisions for this project. The CPO maintains
this file and reads it before delegating tasks; the Architect and Workers
receive relevant excerpts from the CPO rather than reading this
directly.

## Backend

**SQL queries use runtime validation, not compile-time macros.** Use `sqlx::query()` and `sqlx::query_as()`. Never use `query!()` or `query_as!()`. Compile-time macros require a live `DATABASE_URL` at build time or a manually-kept `.sqlx/` cache, creating friction for parallel team development and common build breaks.

**No HTTP compression on GLB responses.** meshopt-encoded GLB buffers are already entropy-coded; gzip/deflate adds ~1-2% size reduction at high CPU cost. Exclude `Content-Type: model/gltf-binary` from any compression middleware.

**Single transcode pipeline for all file sizes.** Every upload—whether a tiny test cube or a 500MB asset—goes through the same server-side transcoding flow. No fast-path for small files; one code path avoids bifurcated maintenance and latent bugs.

**Pinned dependency versions** (spike results, 2026-09-21): axum 0.8.9, tobj 4.0.5, meshopt 0.6.2, gltf-json 1.4.1 (unmaintained ~2.3 years), sqlx 0.9.0, ulid 3.0.0, rand 0.10.3. **API gotchas:** `rand::rngs::OsRng` doesn't exist in 0.10—use `SysRng`. `tobj::Mesh.positions/normals` are `Vec<f32>`, never `f64`.

**`openapi-typescript` is pinned at `^7.13.0`, not `^8.x`.** No 8.x release exists on npm as of 2026-09-21; `^8.2.0` fails with `ETARGET`.

## Tooling

**Source nvm before declaring Node.js unavailable.** A bare non-interactive shell often has no `node` on PATH even when nvm has versions installed (`~/.nvm/versions/node/`). Run `. ~/.nvm/nvm.sh && nvm use <version>` (or check for it) before concluding Node is genuinely absent.

**Share slugs are access control—treat as secrets.** The public `share_slug` in URLs (`/v/{slug}`) is the only access mechanism. Never log it, include in error messages to aggregators, or allow in `Referer` headers. Use the `slug_redaction` middleware or manually scrub.

## Frontend

**Pure TypeScript/three.js in `viewer/three/`; no React imports.** Scene graph, loaders, disposal logic—all unit-testable outside React lifecycle. The React layer in `viewer/components/` never directly creates/disposes three.js resources; it delegates to `three/` functions.

**WASM/worker config in `vite.config.ts`:** use `vite-plugin-wasm` + `worker: { format: 'es' }` + `build.target: 'esnext'`. Do NOT add `vite-plugin-top-level-await`—redundant at esnext target, and its dependency (`@rollup/plugin-virtual`) needs the standalone `rollup` package, which isn't present under Vite 8's rolldown bundler (crashes with `Cannot find module 'rollup'`). Also: `tsconfig.node.json` must use `module: esnext` / `moduleResolution: bundler`, not `nodenext`—`nodenext` misresolves `vite-plugin-wasm`'s dual-package `.d.ts` and produces spurious "not callable" errors.

**Node/npm on this machine requires nvm.** Not on PATH by default in non-interactive shells; run `nvm use --lts` (or see the Tooling note below) before any `npm`/`node` command.
