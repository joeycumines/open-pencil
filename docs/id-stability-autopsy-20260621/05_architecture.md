# 05 — Architectural Issues

## Architecture Boundaries

### AB-1: Core does not import app code — HELD
- **Evidence:** `grep -rn "from '@/app" packages/core/` returns nothing. `bun run check:arch` passes with "No problems found."
- **Note:** The yjs-sync modules (`src/app/collab/yjs-sync/`) properly import from `@open-pencil/core/scene-graph` (public subpath export), not from core internals.

### AB-2: Components do not import views — HELD
- **Evidence:** `grep -rn "views/" src/components/` returns nothing.

### AB-3: App code uses public package exports — HELD
- **Evidence:** `src/app/collab/yjs-sync/mapping.ts:3` imports from `@open-pencil/core/scene-graph`. `src/app/collab/yjs-sync/serialize.ts:3,9` imports from `@open-pencil/core/scene-graph`. No `#core/` alias usage in app code.

### AB-4: No new Steiger violations introduced — HELD
- **Evidence:** `bun run check:arch` passes. The branch was rebased onto main and resolves all conflicts.

## Circular Imports

### CI-1: yjs-sync dependency graph is a clean DAG — HELD
- **Evidence:**
  ```
  constants.ts (no internal imports)
      ↑
  mapping.ts → constants.ts
      ↑
  graph-apply.ts → constants.ts, mapping.ts, serialize.ts
  serialize.ts → mapping.ts
      ↑
  sync.ts → graph-apply.ts, mapping.ts, serialize.ts
      ↑
  index.ts (barrel re-export of all above)
  ```
- **Note:** `graph-apply.ts` imports from `serialize.ts`, and `sync.ts` imports from both. No cycle. The barrel `index.ts` re-exports everything but imports nothing at runtime (only type re-exports).

## Documentation Mismatches

### DM-1: AGENTS.md references renamed file `graph-events.ts`
- **Evidence:** AGENTS.md:79-83 (5 rows in the events table) reference `graph-events.ts`:
  ```
  | `node:created` | `SceneNode` | SceneGraph emitter → `graph-events.ts` |
  | `node:updated` | `id, changes` | SceneGraph emitter → `graph-events.ts` |
  | `node:deleted` | `id` | SceneGraph emitter → `graph-events.ts` |
  | `node:reparented` | `nodeId, oldParentId, newParentId` | SceneGraph emitter → `graph-events.ts` |
  | `node:reordered` | `nodeId, parentId, index` | SceneGraph emitter → `graph-events.ts` |
  ```
  The file was renamed to `events/graph.ts`:
  ```
  packages/core/src/editor/{graph-events.ts => events/graph.ts}
  ```
  The branch updated the `graph:replaced` row (line 78) to reflect the new `GraphReplacedPayload` type, but left the 5 other rows referencing the old filename.
- **Impact:** Contributors following AGENTS.md will look for a non-existent file. The file `packages/core/src/editor/graph-events.ts` does not exist; the content is now at `packages/core/src/editor/events/graph.ts`.

### DM-2: Commit message overstates "dead branch removal"
- **Evidence:** Commit `cc55882a` message:
  > "Remove dead branch in fig/export.ts: !page.source.id to === null (source.id is always non-null after identity system)."
  
  The branch at `export.ts:307` is still present:
  ```js
  if (page.source.id === null) return { sessionID: 0, localID: localIdCounter.value++ }
  ```
  Only the condition syntax changed (`!page.source.id` → `page.source.id === null`). The branch was not removed.
- **Impact:** The commit message creates a false audit trail. A future developer reading the commit log will believe the branch is gone.

### DM-3: Translation map limitation is in AGENTS.md but not in code
- **Evidence:** AGENTS.md:91 documents:
  > "For graphs whose nodes predate source.id, the translation map only guarantees oldRootId → newRootId. Non-root legacy nodes receive fresh synthetic stable ids and are intentionally not included in the map; consumers must treat all non-root ids as invalidated after replaceGraph."
  
  But `buildReplaceGraphTranslation` (create.ts:192-219) has no comments. The `GraphReplacedPayload` type (types.ts:89-92) has no JSDoc. The consumer (`FigmaAPI._translateId`) silently falls back to the original id:
  ```js
  private _translateId(id: string): string {
    return this._translation.get(id) ?? id
  }
  ```
- **Impact:** The "consumers must treat all non-root ids as invalidated" contract is invisible at the code level. A consumer that doesn't read AGENTS.md will assume the translation map is complete.

### DM-4: Blueprint.json claims "600 is a hard limit" but no tool enforces it
- **Evidence:** `blueprint.json:30`:
  > "ZERO max-lines warnings allowed — 600 is a hard limit, not a suggestion."
  
  No `max-lines` rule exists in oxlint, steiger, or any configuration file. `bun run check` does not check file lengths.
  
  Three files are at the boundary:
  - `packages/core/src/figma-api/index.ts` — **600 lines** (exactly at the limit)
  - `packages/core/src/scene-graph/index.ts` — **598 lines** (2 under)
  - `packages/core/src/kiwi/fig/import.ts` — **598 lines** (2 under)
- **Impact:** The "hard limit" is aspirational. Future commits can push these files over 600 with no automated warning. The commit message for `cc55882a` claims "scene-graph/index.ts (648 to 594)" but it's actually 598 — 4 lines grew back after the claimed reduction.

### DM-5: WIP.md claims are accurate but incomplete
- **Evidence:** WIP.md describes:
  - Performance fixes (O(n²) → O(n)) — verified accurate
  - `structuredClone` removal in `updateNode` — verified accurate
  - Stale golden spec update — verified accurate
  - Rule of Two review — verified (2 runs, both PASS)
  
  But WIP.md does NOT mention:
  - The `export.ts:307` "dead branch" that was claimed removed but wasn't
  - The `assumeFigmaPayload` type hole
  - The module-level mutable state concern
  - The `migrateLegacySourceIds` gap (variables/collections/modes not migrated)
- **Impact:** WIP.md is a session log, not a comprehensive review. Its claims are true but its scope is limited to what was fixed, not what was introduced.

## API Surface Changes

### AP-1: `SceneGraph` constructor signature changed
- **Old:** `constructor()`
- **New:** `constructor(options?: SceneGraphOptions)`
- **Backward compatible:** Yes — no-arg constructor still works (options are optional).
- **Consumers:** `tests/engine/scene-graph/basic/graph.test.ts` uses `new SceneGraph()` (no args). `import.ts:496` uses `new SceneGraph(options)`. Both work.

### AP-2: `deleteNode` signature changed
- **Old:** `deleteNode(id: string): void`
- **New:** `deleteNode(id: string, options?: { permanent?: boolean }): void`
- **Backward compatible:** Yes — options are optional. Existing callers that omit options get `permanent: undefined`, which triggers `maybeUnreserveImportedId` (unreserves). This matches the old behavior.
- **Consumers:** `figma-api/index.ts:282,321,488` now pass `{ permanent: true }`. `pen/read.ts:386,496` passes `{ permanent: false }`.

### AP-3: `createNode` signature changed
- **Old:** `createNode(type, parentId, overrides?): SceneNode`
- **New:** `createNode(type, parentId, overrides?, options?): SceneNode`
- **Backward compatible:** Yes — options are optional. The `mode: 'restore'` option enables in-place restoration.
- **Risk:** The restore-mode in-place update path (`restoreNodeInPlace`) is a new code path with complex parent-linkage repair. It's tested (`tests/engine/scene-graph/id-stability/graph-identity-restore.test.ts`, 438 lines), but any future change to `pickRuntimeId` could silently trigger it.

### AP-4: `graph:replaced` event payload changed
- **Old:** `SceneGraph`
- **New:** `GraphReplacedPayload { graph: SceneGraph; translation: Map<string, string> }`
- **Backward compatible:** No — this is a breaking change for event consumers.
- **Migration path:** `compat.ts` provides `graphReplacedPayloadGraph(payload)` to extract the graph. But no production consumer needed it (the app session was updated to destructure the new payload).
- **Note:** The `graph-replaced-breaking.test.ts` explicitly tests this breaking change.
