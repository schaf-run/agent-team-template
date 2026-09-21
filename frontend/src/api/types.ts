// Re-export of the OpenAPI-generated contract types, so the rest of the
// frontend imports from `api/types` instead of reaching into `contract/`
// directly. Do not hand-edit `contract/types.ts` — regenerate it with
// `npm run gen:types` (in `contract/`) instead.
export type { components, operations, paths } from '../../../contract/types.ts'
