# Adversarial Codebase Autopsy: `improve-node-id-stability` Branch

**Date:** 2026-06-21
**Scope:** Cross-cutting concerns — type safety, dead code, architectural invariants, cross-system consistency
**Base:** `main` (c7b9e401)
**Head:** `a62e98b3` (5 commits, 107 files, +7044/-809 lines)

## Verdict

The stable-identity system is **architecturally sound but documented with false precision**. The commit messages and AGENTS.md updates overstate what was accomplished: a "removed" dead branch is still present, a "600 line hard limit" is unenforced, and the `source.id` "always non-null" invariant is conditional on an opt-in migration call that is only invoked from two call sites. The collab layer carries type holes that could silently corrupt data from untrusted peers.

## Document Index

| # | Document | Purpose |
|---|----------|---------|
| 01 | `invariants.md` | Verification table for all claimed invariants |
| 02 | `critical_findings.md` | Numbered findings with evidence and severity |
| 03 | `dead_code.md` | Dead code inventory with file:line references |
| 04 | `type_safety.md` | `as` casts, `!` assertions, type holes |
| 05 | `architecture.md` | Boundary violations, circular imports, doc mismatches |
| 06 | `honest_conclusions.md` | True / Uncertain / False synthesis |

## Recommended Reading Order

1. `01_invariants.md` — what was claimed vs. what holds
2. `02_critical_findings.md` — the issues that matter
3. `06_honest_conclusions.md` — the bottom line

## Critical Caveats

- This analysis is **code-only**. Commit messages and WIP.md are treated as claims, not evidence.
- The `bun run check` suite passes (architecture, lint, typecheck, dupes). This report focuses on what passes checks but is still **wrong or misleading**.
- Three files are at the 600-line boundary (figma-api/index.ts, scene-graph/index.ts, kiwi/fig/import.ts). The "hard limit" is not enforced by any tool.
