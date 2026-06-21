# 02 — Critical Findings

## Finding 1: Commit message falsely claims dead branch removal

**Severity:** MEDIUM (process integrity)

**Evidence:** Commit `cc55882a` message says:
> "Remove dead branch in fig/export.ts: !page.source.id to === null (source.id is always non-null after identity system)."

But `packages/core/src/io/formats/fig/export.ts:307` still contains:
```js
if (page.source.id === null) return { sessionID: 0, localID: localIdCounter.value++ }
```

The branch was **refactored** (truthy check → explicit null check), not **removed**. The commit message is misleading.

**Impact:** The justification "source.id is always non-null after identity system" is the foundation of the invariant claim. If the branch is truly dead, removing it would be safe. The fact that it was kept (just reformatted) suggests the author was not confident the branch is unreachable. The branch IS reachable if `exportFigFile` is called on a graph where `migrateLegacySourceIds()` was not invoked — which is possible since export does not call migration itself.

**Kill condition:** Call `exportFigFile` on a `SceneGraph` constructed via `new SceneGraph()` without calling `migrateLegacySourceIds()`. The root and default page will have `source.id === null` (from `createDefaultSource()`), and the branch at line 307 will execute.

---

## Finding 2: `assumeFigmaPayload` is an unchecked cast from untrusted remote data

**Severity:** HIGH (collaboration security)

**Evidence:** `src/app/collab/yjs-sync/serialize.ts:158-160`:
```js
function assumeFigmaPayload(value: unknown): SourceMetadata['fig'] {
  return value as SourceMetadata['fig']
}
```

Called from `tryParseSourceFig` (line 167) after only an `isRecord(parsed)` check (verifies it's an object). The `SourceMetadata['fig']` type (`FigmaSourcePayload`) has 8 specific fields (`rawSize`, `rawTransform`, `rawNodeFields`, `layout`, `symbolOverrides`, `componentPropAssignments`, `derivedSymbolData`, `derivedSymbolDataLayoutVersion`, `uniformScaleFactor`). None of these are validated.

**Impact:** A malicious or buggy remote peer can send arbitrary JSON in the `sourceFig` Yjs field. `assumeFigmaPayload` will silently produce a malformed `FigmaSourcePayload`. Downstream code accessing `fig.rawNodeFields.backgroundColor` (export-node.ts) or `fig.rawSize` (serialize.ts) will read arbitrary data. This could cause:
- Silent data corruption (wrong colors, sizes, etc.)
- Crashes if the runtime expects specific types (e.g., `rawSize` is `Vector | null` but receives a string)
- Potential prototype pollution if `rawNodeFields` contains `__proto__` keys

**Mitigation:** None in code. The function name "assume" is honest, but the caller doesn't validate the shape.

---

## Finding 3: `stableIdToRuntimeId` and `findNodeByStableId` are O(n) linear scans

**Severity:** MEDIUM (performance)

**Evidence:**
- `identity.ts:163-168` — `stableIdToRuntimeId`: iterates ALL nodes to find one by `source.id`
- `mapping.ts:74-79` — `findNodeByStableId`: iterates ALL nodes to find one by `source.id ?? node.id`

Both are O(n) per call. `findNodeByStableId` is called from `findExistingLocalNode` (graph-apply.ts:151,153) on EVERY incoming Yjs update. In a collaboration session with N nodes and M updates, the cost is O(N × M).

**Impact:** `buildReplaceGraphTranslation` (create.ts:199-203) explicitly builds a Map to avoid calling `stableIdToRuntimeId` — the code acknowledges the O(n) cost. But `findNodeByStableId` in the collab path has no such optimization. It relies on the `state.remoteToLocal` Map for O(1) lookups, but falls back to linear scan when the mapping isn't populated yet (e.g., first update from a new peer).

**Note:** This is not a regression — the old code also used linear scans. But the new identity system introduced `source.id` as a lookup key without building a reverse index (`stableId → runtimeId`), making the O(n) scan more visible.

---

## Finding 4: Module-level mutable state shared across all SceneGraph instances

**Severity:** MEDIUM (multi-tab correctness)

**Evidence:** `packages/core/src/scene-graph/identity.ts:19-20`:
```js
let fallbackLocalID = 1
let documentLocalID = 1
```

These are process-global. Every `SceneGraph` constructor calls `allocateDocumentGuid()` (line 51) which returns `0:${documentLocalID++}`. Two graphs in the same process get `0:1` and `0:2`.

Similarly, `packages/core/src/kiwi/fig/instance-overrides/cache.ts:3-6`:
```js
let siblingIndexCache = new WeakMap<...>()
let siblingGroupCache = new WeakMap<...>()
let candidateCache = new WeakMap<...>()
let componentFindCache = new WeakMap<...>()
```

`clearInstanceOverrideCaches()` (no argument) replaces ALL four with fresh WeakMaps — wiping caches for ALL graphs in the process.

**Impact:**
- **Multi-tab:** If two documents are open, `documentGuid` values are sequential (`0:1`, `0:2`) but reset on process restart. If a saved document has `documentGuid: "0:1"` and the process restarts, a new document also gets `0:1`. The `documentGuid` is stored on the instance but is NOT used for stable id generation (stable ids use `sessionID` which is random). So this is a metadata uniqueness issue, not an id collision issue.
- **Tests:** Parallel tests that call `clearInstanceOverrideCaches()` can wipe each other's caches mid-import, causing flaky failures. The `bunfig.toml` preload (`tests/helpers/mcp-discovery-isolation.ts`) doesn't isolate these caches.
- **Instance overrides:** If two imports run concurrently (unlikely in single-threaded JS but possible in worker threads), one `clearInstanceOverrideCaches()` call wipes the other's lookup caches.

---

## Finding 5: `migrateLegacySourceIds` does not migrate variables, collections, or modes

**Severity:** LOW

**Evidence:** `identity.ts:170-185` — only iterates `this.host.nodes.values()`. Does not touch `this.host.variables`, `this.host.variableCollections`, or `collection.modes`.

`createVariable` (variables.ts:77) and `createCollection` (variables.ts:103) set `source.id = id` (non-null), so newly created entities are fine. Imported entities get `source.id` from `mintFigmaSourceMetadata` (import.ts:288,319,363). But legacy entities loaded from old .fig files (before the identity system) may have `source === undefined` or `source.id === null`.

**Impact:** `recomputeReservedRuntimeIds` (identity.ts:144-157) handles this with optional chaining (`source?.format`). But `stableIdForNode` (mapping.ts:8) only handles nodes. Variables are synced by their `id` directly, not by `source.id`. This is inconsistent but not broken — just an incomplete migration story.

---

## Finding 6: AGENTS.md references renamed file `graph-events.ts`

**Severity:** LOW (documentation accuracy)

**Evidence:** AGENTS.md:79-83 (5 rows in the events table) reference `graph-events.ts`:
```
| `node:created` | `SceneNode` | SceneGraph emitter → `graph-events.ts` |
| `node:updated` | `id, changes` | SceneGraph emitter → `graph-events.ts` |
...
```

But the file was renamed to `events/graph.ts` in this branch:
```
packages/core/src/editor/{graph-events.ts => events/graph.ts}
```

The branch updated the `graph:replaced` row (line 78) but left the 5 other rows referencing the old filename. The file `packages/core/src/editor/graph-events.ts` no longer exists.

**Impact:** Contributors following AGENTS.md to find the event emission code will look for a non-existent file. Minor friction, but the branch that was supposed to update the docs left them inconsistent.

---

## Finding 7: Translation map limitation is undocumented in code

**Severity:** LOW (consumer safety)

**Evidence:** AGENTS.md:91 says:
> "For graphs whose nodes predate source.id, the translation map only guarantees oldRootId → newRootId. Non-root legacy nodes receive fresh synthetic stable ids and are intentionally not included in the map; consumers must treat all non-root ids as invalidated after replaceGraph."

But `buildReplaceGraphTranslation` (create.ts:192-219) has NO comments explaining this limitation. The `GraphReplacedPayload` type (types.ts:89-92) has no JSDoc. The consumer (`FigmaAPI._translateId`, figma-api/index.ts:186-188) silently falls back to the original id:
```js
private _translateId(id: string): string {
  return this._translation.get(id) ?? id
}
```

**Impact:** If a consumer holds a runtime id for a legacy non-root node and calls `getNodeById(oldId)` after `replaceGraph`, `_translateId` returns `oldId` unchanged, then `graph.getNode(oldId)` returns `undefined` (the new graph doesn't have this id). The consumer gets `null` silently. No error, no warning. The "consumers must treat all non-root ids as invalidated" contract is unenforced and invisible at the code level.

---

## Finding 8: `NodeProps = Record<string, unknown>` discards all type safety for collab data

**Severity:** MEDIUM (type safety)

**Evidence:** `src/app/collab/yjs-sync/constants.ts:9`:
```js
export type NodeProps = Record<string, unknown>
```

All Yjs-to-graph conversion functions (`yNodeToProps`, `buildCreateProps`, `buildUpdateProps`) take `NodeProps` and cast to `Partial<SceneNode>`:
- `serialize.ts:230` — `} as Partial<SceneNode>`
- `serialize.ts:282` — `return { ...update, id: existing.id } as Partial<SceneNode>`

The `as Partial<SceneNode>` casts are necessary because `NodeProps` is untyped. Every property access on `props` requires `asString()` or similar runtime guards, but the final cast to `Partial<SceneNode>` bypasses all checks.

**Impact:** A remote peer sending malformed data (e.g., `x: "not a number"`) will pass through `yNodeToProps` and be cast to `Partial<SceneNode>` without validation. The malformed value reaches `graph.updateNode` / `graph.createNode`, which does no type checking on property values. Downstream rendering code that expects `node.x` to be a number will fail.

---

## Finding 9: `__getNodeCacheForTest` exposed on public FigmaAPI class

**Severity:** LOW (API hygiene)

**Evidence:** `packages/core/src/figma-api/index.ts:131`:
```js
__getNodeCacheForTest(): Map<string, FigmaNodeProxy> {
  return this._nodeCache
}
```

This is a test-only method on the public `FigmaAPI` class. The double-underscore prefix signals "private but accessible," but it's still part of the public API surface. Only consumed by `tests/engine/figma-api/cache-invalidation.test.ts`.

**Impact:** Pollutes the public API. If `FigmaAPI` is consumed by external code (e.g., plugins, MCP tools), this method is visible. Not a security issue, but violates separation of test and production concerns.

---

## Finding 10: `joinOverrideKey` is exported but never called

**Severity:** LOW (dead code)

**Evidence:** `packages/core/src/scene-graph/override-key.ts:19-21`:
```js
export function joinOverrideKey(childId: string, prop: string): string {
  return `${childId}:${prop}`
}
```

Re-exported from `scene-graph/index.ts:7`. Zero consumers in `packages/`, `src/`, or `tests/`. Only the function definition and re-export exist.

**Impact:** Dead code. The inverse `splitOverrideKey` IS used (5 consumers). `joinOverrideKey` was likely added for symmetry but never needed.
