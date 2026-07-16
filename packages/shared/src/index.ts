/**
 * Public entrypoint for the shared contract package. Re-exports all enums, zod
 * schemas, and inferred types. Both `server` and `web` import from `shared`.
 */

export * from './enums.js';
export * from './schema.js';
export * from './constants.js';
export * from './domain/task.js';
export * from './presentation/task.js';
// `types.ts` re-exports types already surfaced by enums/schema; importing it here
// would duplicate exports, so consumers use `import type { ... } from 'shared'`.
