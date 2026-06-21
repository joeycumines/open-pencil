# 06 — Honest Conclusions

## TRUE (Verified by code, no reasonable doubt)

1. **The stable identity system works for its primary use case.** Nodes created via `createNode` always get a non-null `source.id` via `buildSource` (`identity.ts:193-202`). Imported nodes get `source.id` from `mintFigmaSourceMetadata`. The `sessionID:localID` format guarantees uniqueness within a session.
   - Evidence: `identity.ts:99-116` (generateNodeId), `identity.ts:193-202` (buildSource), `import.ts:498` (mintFigmaSourceMetadata)

2. **The O(n²) performance regression was fixed.** `generateNodeId` uses direct `Map.has` lookups instead of rebuilding a full known-id Set. The commit message and WIP.md are accurate.
   - Evidence: `identity.ts:81-116` (comment explains the fix), WIP.md:38-46

3. **The yjs-sync split into 6 modules has no circular imports.** The dependency graph is a clean DAG.
   - Evidence: Import analysis in `05_architecture.md`

4. **The `as ReconcileRootFn` and `as TestStore` casts were removed.** The commit message is accurate on these points.
   - Evidence: `use.ts:103`, `helpers.ts:20-24,65-74`

5. **The dead if-block in `reorderChild` was removed.** The new `node/reorder.ts` is clean.
   - Evidence: `node/reorder.ts:1-35` vs old `index.ts:450` (main)

6. **The translation map limitation is accurately documented in AGENTS.md.** The note about legacy documents is correct.
   - Evidence: `create.ts:192-219` — old graph nodes with `source.id === null` are skipped, so only root is guaranteed.

7. **`bun run check` passes with zero errors and zero warnings.** Architecture, lint, typecheck, and dupes all pass.
   - Evidence: Ran `bun run check` — all green.

8. **No architecture boundary violations were introduced.** Core doesn't import app code. Components don't import views.
   - Evidence: `bun run check:arch` passes.

## UNCERTAIN (Evidence suggests but proof is incomplete)

1. **Module-level mutable state is safe for multi-tab use.** `fallbackLocalID` and `documentLocalID` (`identity.ts:19-20`) are process-global. The `documentGuid` is metadata (not used for id generation), so stable ids don't collide. But if two tabs import the same .fig file simultaneously, the instance-override caches (`cache.ts:3-6`) could interfere. In single-threaded JS this is unlikely, but worker threads or SharedArrayBuffer scenarios could break.
   - What would resolve it: A test that creates two SceneGraphs, runs an import on each, and verifies the instance-override caches don't cross-contaminate.

2. **The `assumeFigmaPayload` type hole has never been exploited.** The cast from `unknown` to `SourceMetadata['fig']` is unchecked. In practice, the only remote data source is Yjs from trusted peers (same room ID). But Trystero uses public MQTT brokers for signaling — a malicious peer could join a room and send malformed `sourceFig` data.
   - What would resolve it: A fuzz test that sends malformed `sourceFig` JSON through the Yjs sync path and verifies no crashes or data corruption.

3. **`stableIdToRuntimeId` O(n) linear scan is acceptable.** The public API is O(n) per call, but production code avoids it (create.ts builds its own Map). The collab code uses `state.remoteToLocal` Map for O(1) lookups, falling back to `findNodeByStableId` (O(n)) only when the mapping isn't populated. For large documents (87k nodes), this could be slow during initial sync.
   - What would resolve it: A benchmark of collab initial sync on a large document.

4. **The `permanent` option naming on `deleteNode` is correct.** `permanent: true` unreserves the imported id. `permanent: false` keeps it reserved. The semantics are correct but the naming is counterintuitive — "permanent" should mean "forever," but it actually means "unreserve the id."
   - What would resolve it: A rename to `unreserveImportedId: boolean` or `keepReserved: boolean` would be clearer. But this is a naming issue, not a correctness issue.

## FALSE (Directly contradicted by code or evidence)

1. **"source.id is always non-null after identity system."** FALSE. `createDefaultSource()` returns `id: null` (`defaults.ts:7`). The root constructor at `index.ts:137` can produce a node with `source.id === null` if `rootSource.id` is null. `migrateLegacySourceIds()` must be explicitly called to guarantee non-null. The 7 `source.id !== null` checks in the codebase are NOT dead code — they guard pre-migration state.
   - Evidence: `defaults.ts:7`, `index.ts:137`, `identity.ts:170-185`

2. **"Remove dead branch in fig/export.ts."** FALSE. The branch at `export.ts:307` is still present. Only the condition syntax changed.
   - Evidence: `export.ts:307`, commit `cc55882a` message

3. **"600 is a hard limit, not a suggestion."** FALSE. No tooling enforces a 600-line limit. `figma-api/index.ts` is exactly 600 lines. Two other files are at 598. The "hard limit" is aspirational.
   - Evidence: `blueprint.json:30`, no `max-lines` rule in any config, `wc -l` on changed files

4. **"All type casts in helpers.ts were removed."** FALSE. 5 `as` casts remain in `createNodeEventBridge`. They were centralized and documented, not removed.
   - Evidence: `helpers.ts:40,43,46,49,57`, commit `cc55882a` message

## Bottom Line

The stable identity system is **well-implemented for its core purpose** (stable node ids across save/reload/import). The performance fixes are real and verified. The architecture is clean (no boundary violations, no circular imports).

The problems are in **documentation precision and type safety at the edges**:
- The commit messages overstate what was accomplished (dead branch "removed" that wasn't, casts "removed" that were centralized).
- The `source.id` invariant is conditional, not absolute — and the code correctly defends against this, but the documentation doesn't acknowledge the condition.
- The collab layer has a type hole (`assumeFigmaPayload`) that trusts untrusted peer data.
- The "600 line hard limit" is unenforced.
- AGENTS.md references a renamed file in 5 places.

None of these are showstoppers. The system works. But the gap between what the commit messages claim and what the code actually does is wider than it should be.
