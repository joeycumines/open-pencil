# 03 — Dead Code Inventory

## Confirmed Dead Code

### DC-1: `joinOverrideKey` function
- **File:** `packages/core/src/scene-graph/override-key.ts:19-21`
- **Re-export:** `packages/core/src/scene-graph/index.ts:7`
- **Consumers:** 0 (only the definition and re-export)
- **Evidence:** `grep -rn "joinOverrideKey" --include="*.ts" packages/ src/ tests/` returns only the definition and re-export. No call sites.
- **Note:** The inverse `splitOverrideKey` has 5 consumers (clipboard.ts:212, serialize.ts:150, serialize.ts:295, and 2 test files).

### DC-2: `graphReplacedPayloadGraph` compat helper (production)
- **File:** `packages/core/src/editor/events/compat.ts:4-6`
- **Re-export:** `packages/core/src/editor/index.ts:3`
- **Production consumers:** 0
- **Test consumers:** 1 (`tests/engine/editor/events/graph-replaced-breaking.test.ts:6,35`)
- **Evidence:** The helper extracts `.graph` from `GraphReplacedPayload`. It exists for backward compatibility with consumers that previously received a bare `SceneGraph` from the `graph:replaced` event. But the only consumer is a test that verifies backward compatibility. No production code uses it. The app session (`src/app/editor/session/create.ts:46`) destructures `{ graph, translation }` directly.
- **Note:** Not strictly dead (it's a public API export), but it's dead in production.

### DC-3: `generateId()` deprecated function
- **File:** `packages/core/src/scene-graph/identity.ts:22-25`
- **Re-exports:** `scene-graph/index.ts:6`, `core/src/index.ts:27`
- **Production consumers:** 0
- **Test consumers:** 1 (`tests/engine/scene-graph/basic/graph.test.ts:23`)
- **Evidence:** Marked `@deprecated Use SceneGraph.generateNodeId instead.` Still exported from the public API. The one test that uses it (`const probe = generateId()`) should be migrated to `graph.generateNodeId()`.
- **Note:** The `generateId` PARAMETER name in `variables.ts:55` and `node/defaults.ts:24` is NOT the deprecated function — it's a callback parameter that happens to share the name.

### DC-4: `NodeTreeAccess` interface (over-abstraction)
- **File:** `packages/core/src/scene-graph/node/tree.ts:23-27`
- **Consumers:** 1 (SceneGraph, passed as `this`)
- **Evidence:** The interface abstracts `getNode`, `getChildren`, and `rootId` so `countDescendants` and `flattenTree` can work with any tree-like structure. But the only implementation is `SceneGraph` itself. No mock, no alternative implementation, no test double. The abstraction adds indirection without enabling testing or flexibility.
- **Note:** Not dead code per se (the functions ARE called), but the interface is over-engineered for a single consumer.

### DC-5: `importDiagnostics` field (production-dead)
- **File:** `packages/core/src/scene-graph/index.ts:114`
- **Type:** `FigImportDiagnostics | undefined`
- **Production readers:** 0
- **Test readers:** 5 test files
- **Evidence:** Populated during import (`import.ts:519`), but never read by any production code. Only tests assert on `duplicateGuids`, `missingGuidCount`, and `reassignedGuids`. The field is a diagnostic API with no production consumer.
- **Note:** Useful for debugging, but technically dead in production.

### DC-6: `export.ts:307` null branch (claimed removed, still present)
- **File:** `packages/core/src/io/formats/fig/export.ts:307`
- **Code:** `if (page.source.id === null) return { sessionID: 0, localID: localIdCounter.value++ }`
- **Evidence:** Commit `cc55882a` claims "Remove dead branch in fig/export.ts." The branch was NOT removed — only the condition was changed from `!page.source.id` to `page.source.id === null`. The branch is still present as a defensive fallback.
- **Note:** If the invariant "source.id is always non-null after identity" were truly enforced, this branch would be unreachable. Its presence contradicts the commit message.

## Not Dead Code (Verified)

### `source.id !== null` checks (7 sites)
- `identity.ts:62` — `isReservedImportedId`: guards pre-migration nodes
- `identity.ts:147` — `recomputeReservedRuntimeIds`: guards undefined source
- `identity.ts:175,181` — `migrateLegacySourceIds`: the migration logic itself
- `update.ts:15` — `guardSourceChanges`: preserves existing stable id
- `create.ts:206` — `buildReplaceGraphTranslation`: skips pre-migration nodes
- `export.ts:307` — defensive fallback in export

All are legitimate guards for pre-migration state. None are dead.

### `as` casts in `createNodeEventBridge` (5 sites in helpers.ts)
- `helpers.ts:40,43,46,49,57`
- Documented with a comment explaining TypeScript's inability to narrow generic type parameters in switch cases.
- Centralized into one function (was previously scattered).
- Not dead — actively used by the test infrastructure.
