# OpenPencil - Project Guidelines & Context

This document provides rules, architecture constraints, and codebase context for OpenPencil: a Vue 3, CanvasKit (Skia WASM), and Yoga WASM design editor. It runs as a Tauri v2 desktop app and a browser PWA.

## Common Commands & Quality Gates

**Quality Gates (Must pass before committing):**
- `bun run check` — type-aware lint + typecheck (oxlint + tsgo). Zero errors required.
- `bun run format` — code formatting + import sorting.
- `bun run test:dupes` — jscpd copy-paste detection (< 3% duplication).
- `bun run test:unit` — bun:test unit test suite.
- `bun run test` — Playwright E2E visual regression.

**Development:**
- `bun run dev` — Dev server at localhost:1420
- `bun run tauri dev` — Desktop app with hot reload (requires Rust)
- `bun run build` / `bun run tauri build` — Production/Desktop builds
- `bun run check:vue` — vue-tsc type-check (fix progressively)

**CLI Tools (Do not assume they are in PATH):**
Run local CLI commands directly (e.g., via bun or local package execution). Note the binary is `openpencil`, not `open-pencil`. Server variants are `openpencil-mcp-http` and `openpencil-mcp`.
- `openpencil tree <file>` — Browse node tree of a design file
- `openpencil info <file>` — Document stats
- `openpencil export <file>` — Headless render to PNG/JPG/WEBP
- `openpencil analyze <domain> <file>` — Domains: colors, typography, spacing, clusters
- `openpencil eval <file> --code '<js>'` — Execute JS with Figma Plugin API

*Note: CLI commands must use `agentfmt` for output. Do not hand-roll `console.log` formatting; use `packages/cli/src/format.ts`.*

## Architecture & Monorepo Structure

Bun workspace with the following core packages:
- `packages/core` (`@open-pencil/core`): Scene graph, renderer, layout, codec, tools. Zero DOM deps, runs headless.
- `packages/vue` (`@open-pencil/vue`): Headless Vue 3 SDK (composables, renderless components).
- `packages/cli` (`@open-pencil/cli`): Headless CLI tooling.
- `packages/mcp` (`@open-pencil/mcp`): MCP integration. *(Note: Protocol and transport implementation details are heavily WIP/custom; interact strictly via standard ToolDefs rather than low-level networking).*
- `src/`: Vue 3 frontend / desktop editor.
- `desktop/`: Tauri v2 Rust backend.

## Code Conventions (Strict)

### TypeScript & JavaScript
- **No `any` or `!` assertions.** Use proper types, guards, `?.`, and `??`.
- **No `Math.random()`.** Use `crypto.getRandomValues()` exclusively.
- **Guard browser APIs.** Always use `typeof window !== 'undefined'` and `typeof document === 'undefined'` in core packages.
- **Deep copies.** Use `structuredClone()` for deep copies. Never use shallow spreading when mutating nested objects.
- **Named Types.** Avoid inline object shapes. Use shared named types: `Color`, `Vector`, `SceneNode`, `Effect`, `Fill`, `Stroke` from `scene-graph.ts` and `types.ts`.
- **Precise Unions.** Use literal unions (`'closed' | 'half' | 'full'`), not generic strings.
- **Imports:** Use `@/` alias for app cross-directory imports and relative imports within core.

### Vue & UI (Tailwind + Reka)
- **No module-level mutable state** in components. Use the central EditorStore (`src/stores/editor.ts`).
- **No inline CSS / `<style>` blocks.** Use Tailwind 4. Use `tw-animate-css` for animations.
- **Leverage Reka UI.** Always use existing Reka UI primitives (Dialog, Popover, Select, DropdownMenu, etc.) instead of custom implementations.
- **Icons:** Use `unplugin-icons` with Iconify/Lucide (`<icon-lucide-*>`). Do not use raw SVG/Unicode.
- **Isolate repaints.** Use `contain: paint layout style` on side panels to isolate from the WebGL canvas.

### Dependencies & Abstractions
- **Don't hand-roll.** Check existing dependencies first. Use `culori` for color math, `diff` for unified diffs, `@vueuse/core` for DOM/Browser event hooks.
- **File size.** Keep files under ~600 lines. Split by domain when they grow.

## Domain Guidelines

### Rendering (Skia/CanvasKit)
- CanvasKit runtime is imported ONLY in `canvaskit.ts`. All other files must use `import type`.
- `renderVersion` vs `sceneVersion`: `renderVersion` triggers canvas repaint (pan/zoom/hover). `sceneVersion` represents scene graph mutations. UI panels watch `sceneVersion`.
- **Render methods:** `requestRender()` bumps both; `requestRepaint()` bumps only `renderVersion`. `renderNow()` is only for surface recreation/font loading.
- **Resize Observer:** Use `requestAnimationFrame` (rAF) throttling, NOT debouncing (debounce causes canvas skew).
- **Selection Borders:** Width must be constant regardless of zoom (divide by scale).
- **Rulers:** Rendered on the canvas (not DOM) with non-overlapping selection badges.

### Scene Graph & Layout
- Nodes live in a flat `Map<string, SceneNode>`, maintaining tree hierarchy via `parentIndex` references.
- **Frames:** Clip content by default is **OFF**.
- **Auto-layout (Shift+A):** Sort children by geometric position first. Must call `computeAllLayouts()` (Yoga WASM) immediately to update bounds.
- **Reparenting:** Dragging a child outside a frame reparents it (does not clip it). Groups preserve children's visual positions on creation.

### Components & Instances
- System color is Purple (`#9747ff`) for COMPONENT, COMPONENT_SET, and INSTANCE.
- Instance overrides use key format: `"childId:propName"`.
- Modifying a component requires calling `syncIfInsideComponent()` to propagate changes to instances.
- Use `SceneGraph.copyProp<K>()` (which wraps `structuredClone`) for arrays.

### Tools & Editor State
- `packages/core/src/tools/`: Tools are framework-agnostic `ToolDef` objects split by domain (read, create, modify, structure, variables, vector, analyze).
- Modifying or adding a tool: Define in the correct domain file, then export in `ALL_TOOLS` inside `registry.ts`.
- `FigmaAPI` (`packages/core/src/figma-api.ts`) is the execution target for all tools.
- **Mac Keyboard bindings:** Use `e.code` instead of `e.key` for modifier shortcuts to avoid Option-key character transforms.

### Data Formats & Persistence
- `.fig` files use the custom Kiwi binary codec + zstd compression.
- Vector data uses `vectorNetworkBlob` format.
- Collaboration uses Trystero (WebRTC) + Yjs (CRDT) via `y-indexeddb` for persistence. Room IDs require `crypto.getRandomValues()`. Stale cursors are cleaned via `removeAwarenessStates()`.
- Use file fixtures (`tests/fixtures/*.fig`) which are stored via Git LFS.

## Commits & Releases

- Use **Conventional Commits** (`feat:`, `fix:`, `refactor:`, `docs:`, etc.) for all non-release PRs. Start commit body bullets with a capital letter.
- Scopes should match architecture: `core`, `cli`, `mcp`, `vue`, `docs`, `tauri`, `editor`, `scene-graph`, `canvas`, `tools`, etc.
- **Releases:**
  1. Update versions in `package.json`, workspace packages, and `desktop/tauri.conf.json`.
  2. Move `CHANGELOG.md` "Unreleased" items to the new version header.
  3. Commit exactly as: `Release v0.x.y`
  4. Tag: `git tag v0.x.y && git push --tags`
