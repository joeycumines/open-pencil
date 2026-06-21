# 04 — Type Safety Issues

## `as` Casts in the Diff

### TS-1: `assumeFigmaPayload(value: unknown): SourceMetadata['fig']`
- **File:** `src/app/collab/yjs-sync/serialize.ts:158-160`
- **Code:** `return value as SourceMetadata['fig']`
- **Risk:** HIGH — Casts `unknown` to a complex type (`FigmaSourcePayload` with 8 fields) with only an `isRecord()` check (verifies it's an object). No field-level validation. Processes untrusted remote peer data in collaboration.
- **Fix:** Add a runtime validator (e.g., `valibot` schema) or at minimum check for the presence of expected fields before casting.

### TS-2: `as { symbolID?: GUID } | undefined` (3 sites)
- **Files:**
  - `packages/core/src/kiwi/fig/identity.ts:41`
  - `packages/core/src/kiwi/fig/guid-remap.ts:75`
  - `packages/core/src/kiwi/fig/node-change/convert.ts:976`
- **Risk:** LOW — The codec type (`codec/index.ts:412`) is `{ symbolID: GUID } | undefined` (symbolID required when present). The cast widens to `{ symbolID?: GUID } | undefined` (symbolID optional). This is technically incorrect but defensively safe (optional chaining handles missing fields).
- **Note:** The `RawSymbolData` cast at `convert.ts:959` suggests the runtime shape differs from the codec type. The casts are pragmatic workarounds for a type mismatch between the Kiwi schema and the codec type definitions.

### TS-3: `as GUID` on `overrideKey` (2 sites)
- **Files:**
  - `packages/core/src/kiwi/fig/identity.ts:39`
  - `packages/core/src/kiwi/fig/guid-remap.ts:91`
- **Risk:** LOW — Preceded by a runtime guard: `typeof overrideKey === 'object' && 'sessionID' in overrideKey && 'localID' in overrideKey`. The cast narrows from `unknown` to `GUID` after structural validation. Acceptable.

### TS-4: `as Array<[string, unknown]>` on `Object.entries`
- **File:** `packages/core/src/scene-graph/index.ts` (in `updateNode`)
- **Code:** `const entries = Object.entries(guardedChanges) as Array<[string, unknown]>`
- **Risk:** NONE — Standard TypeScript pattern. `Object.entries` returns `[string, T][]` but `Partial<SceneNode>` produces `unknown` values. The cast is a type-system formality, not a type hole.

### TS-5: `as Partial<SceneNode>` (2 sites in serialize.ts)
- **Files:**
  - `src/app/collab/yjs-sync/serialize.ts:230` — `} as Partial<SceneNode>`
  - `src/app/collab/yjs-sync/serialize.ts:282` — `return { ...update, id: existing.id } as Partial<SceneNode>`
- **Risk:** MEDIUM — Casts from `NodeProps` (which is `Record<string, unknown>`) to `Partial<SceneNode>`. The `NodeProps` type carries no type information — every property is `unknown`. The cast to `Partial<SceneNode>` is unsupported by any runtime validation. Malformed remote data passes through unchecked.
- **Fix:** Introduce a proper `NodeProps` schema with runtime validation, or use `valibot`/`zod` to parse incoming Yjs data.

### TS-6: `as SourceMetadata['fig']` (in assumeFigmaPayload)
- Same as TS-1. Listed separately for the cast inventory.

### TS-7: `def.value as string | number`
- **File:** `packages/core/src/io/formats/pen/convert.ts` (in `buildVarContext`)
- **Risk:** LOW — `def.value` is typed as `PenVariable['value']` which is `string | number | PenVariableEntry[]`. The cast narrows to `string | number` in the `else` branch (after the array case is handled). Acceptable.

### TS-8: `node.source.fig.rawNodeFields as JsonObject | undefined`
- **File:** `packages/core/src/kiwi/fig/node-change/serialize.ts:249`
- **Risk:** NONE — Pre-existing cast (not new to this branch). `rawNodeFields` is typed as `Record<string, unknown>`, and `JsonObject` is a compatible type. The cast is for `valibot` compatibility.

### TS-9: `symbolData as KiwiNodeChange['symbolData']`
- **File:** `packages/core/src/kiwi/fig/node-change/export-node.ts:469`
- **Risk:** LOW — Casts a `Record<string, unknown>` to the Kiwi schema type. Pre-existing pattern for building Kiwi node changes. Not new to this branch.

## Non-Null Assertions (`!`)

No new `!` non-null assertions were found in the diff. The branch avoids `!` in favor of `??`, `?.`, and explicit guards. This is consistent with AGENTS.md's "No `!` non-null assertions" rule.

## Inline Type Definitions

### IT-1: `localIdCounter: { value: number }`
- **File:** `packages/core/src/io/formats/fig/export.ts:298, 256`
- **Risk:** NONE — A mutable counter wrapper. Not a named type, but a pragmatic pattern for passing a mutable number by reference. No named type exists for this.

### IT-2: `options?: { permanent?: boolean }`
- **File:** `packages/core/src/scene-graph/node/delete.ts:3,31`
- **Risk:** NONE — A focused options type. Could be extracted to a named type if reused, but currently only `deleteNode` and `deleteNodes` use it.

### IT-3: `{ remoteRootStableId: string; ynode: Y.Map<unknown> } | null`
- **File:** `src/app/collab/yjs-sync/graph-apply.ts` (return type of `reconcileRemoteRoot`)
- **Risk:** NONE — A specific return type. Could be named, but it's a single-use type.

## Summary

| ID | Cast | Risk | New? |
|----|------|------|------|
| TS-1 | `unknown as SourceMetadata['fig']` | HIGH | Yes |
| TS-2 | `symbolData as { symbolID?: GUID }` | LOW | Yes |
| TS-3 | `overrideKey as GUID` | LOW | Yes |
| TS-4 | `entries as Array<[string, unknown]>` | NONE | Yes (moved) |
| TS-5 | `NodeProps as Partial<SceneNode>` | MEDIUM | Yes |
| TS-8 | `rawNodeFields as JsonObject` | NONE | No (pre-existing) |
| TS-9 | `symbolData as KiwiNodeChange['symbolData']` | LOW | No (pre-existing) |

**High-risk casts:** 1 (TS-1, untrusted remote data)
**Medium-risk casts:** 1 (TS-5, untyped Yjs data)
**Low-risk casts:** 4 (all with runtime guards or narrowing)
**No-risk casts:** 2 (type-system formalities)
