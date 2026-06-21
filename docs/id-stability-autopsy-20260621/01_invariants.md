# 01 — Invariants Verified

## Invariant Table

| # | Invariant | Status | Evidence | Notes |
|---|-----------|--------|----------|-------|
| 1 | `source.id` is always non-null after identity system | **VIOLATED** | `identity.ts:175-184`, `index.ts:137` | Conditional on `migrateLegacySourceIds()` being called. Root construction with `rootSource.id === null` produces a node with `source.id === null` until migration runs. Migration is called from only 2 sites: `editor/create.ts:222` and `kiwi/fig/import.ts:591`. |
| 2 | `source.id` checks for null are dead code | **FALSE** | `identity.ts:62,147,175,181`, `update.ts:15`, `create.ts:206`, `export.ts:307` | 7 distinct null checks exist. All are defensive guards for pre-migration state. None are dead. |
| 3 | Dead branch in `export.ts:307` was removed | **FALSE** | `export.ts:307` | Branch still exists. Changed from `!page.source.id` (truthy) to `page.source.id === null` (explicit). Commit message `cc55882a` says "Remove dead branch" — misleading. |
| 4 | Dead if-block in `reorderChild` was removed | **TRUE** | `node/reorder.ts:1-35` | Old `reorderChild` (main `index.ts:450`) had a convoluted if-block with empty body. New `reorder.ts` is clean. |
| 5 | `as ReconcileRootFn` cast was removed | **TRUE** | `use.ts:103` | Line passes `reconcileRemoteRoot` without cast. |
| 6 | `as TestStore` cast was removed | **TRUE** | `helpers.ts:20-24,65-74` | Replaced with proper `TestStore` interface and `createTestStore()` factory. |
| 7 | All `as` casts in helpers.ts were removed | **FALSE** | `helpers.ts:40,43,46,49,57` | 5 `as` casts remain in `createNodeEventBridge`. Centralized and documented, not removed. |
| 8 | 600-line hard limit is enforced | **FALSE** | No `max-lines` rule in oxlint, steiger, or any config | Blueprint.json:30 says "600 is a hard limit, not a suggestion." No tooling enforces it. 3 files are at 598-600 lines. |
| 9 | No circular imports in yjs-sync | **TRUE** | DAG: constants ← mapping ← {graph-apply, serialize} ← sync ← index | Clean dependency graph. Verified via import analysis. |
| 10 | Core does not import app code | **TRUE** | `grep -rn "from '@/app" packages/core/` returns nothing | Architecture boundary held. Steiger confirms. |
| 11 | Components do not import views | **TRUE** | `grep -rn "views/" src/components/` returns nothing | Architecture boundary held. |
| 12 | `graph:replaced` AGENTS.md documentation matches implementation | **PARTIAL** | `AGENTS.md:78`, `types.ts:89-92`, `create.ts:234` | Payload type matches. Translation limitation note is accurate. But AGENTS.md still references `graph-events.ts` (5 rows) which was renamed to `events/graph.ts`. |
| 13 | Translation map limitation is documented in code | **FALSE** | `create.ts:192-219` | No comments in code explaining the legacy-document limitation. Only documented in AGENTS.md. |
| 14 | `generateId()` deprecation is complete | **FALSE** | `identity.ts:23`, `tests/engine/scene-graph/basic/graph.test.ts:23` | Still exported from `@open-pencil/core` and `@open-pencil/core/scene-graph`. Still used by 1 test. Not removed. |
| 15 | `source.format` is always set | **TRUE** | `defaults.ts:6` | Defaults to `null`. Set to `'fig'` during import (`import.ts:33,48`). The type is `'fig' | null`. |
| 16 | `stableIdToRuntimeId` is O(1) | **FALSE** | `identity.ts:163-168` | Linear scan over all nodes. O(n) per call. `buildReplaceGraphTranslation` (`create.ts:199`) explicitly builds a Map to avoid this, but the public API remains O(n). |
| 17 | `findNodeByStableId` (collab) is O(1) | **FALSE** | `mapping.ts:74-79` | Linear scan over `graph.getAllNodes()`. Called on every incoming Yjs update via `findExistingLocalNode`. |
| 18 | `migrateLegacySourceIds` migrates all entities | **FALSE** | `identity.ts:170-185` | Only iterates `host.nodes`. Does NOT migrate variables, collections, or modes. |
| 19 | Module-level mutable state is safe for multi-tab | **UNCERTAIN** | `identity.ts:19-20`, `instance-overrides/cache.ts:3-6` | `fallbackLocalID` and `documentLocalID` are process-global. Multiple SceneGraph instances share them. `documentGuid` values are `0:1`, `0:2`, etc. — unique within a process but reset on restart. Instance-override caches are also module-level. |
| 20 | `compat.ts` is needed for backward compatibility | **FALSE** | `compat.ts:1-6` | Only consumer is 1 test file. No production code uses `graphReplacedPayloadGraph`. Dead code in production. |
