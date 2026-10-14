# Unreleased changes

Each pull request with a user-facing change adds its changelog bullets here instead of editing `CHANGELOG.md`, so two pull requests never touch the same file:

```
changes/<pull request>/<category>.md
```

`<category>` is `breaking`, `added`, `changed`, `fixed`, `performance`, or `security`. A file holds one bulleted list, written as it will read in the changelog:

```md
- Text keeps a case, a link, and variable bindings for any range of its characters, as in Figma.
```

Open the pull request first, then name the folder after its number. `bun run check:changelog` validates the fragments as they will read once assembled, and fails on entries written under `## Unreleased` in `CHANGELOG.md`. At release, `bun run changelog:assemble` moves them under `## Unreleased` and deletes the folders; the release pass in `AGENTS.md` then curates the section.
