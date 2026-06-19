import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import * as path from 'node:path'

const SUSPECT_LISTENER =
  /onEditorEvent\(\s*['"]graph:replaced['"]\s*,\s*(graph\b|\(?\s*graph\s*\)?)/g
const ALLOWED_EMIT =
  /emitEditorEvent\(\s*['"]graph:replaced['"]\s*,\s*(payload\s*\)|\{[\s\S]*?\}\s*\))/g

const SCAN_DIRS = [
  'packages/core/src',
  'packages/vue/src',
  'packages/cli/src',
  'packages/mcp/src',
  'src',
  'tests'
]

function walk(dir: string, files: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue
      walk(full, files)
    } else if (/\.(ts|vue|tsx|mts|cts)$/.test(entry)) {
      files.push(full)
    }
  }
}

describe('graph:replaced listener inventory', () => {
  test('no listener treats graph:replaced payload as a bare SceneGraph', () => {
    const offenses: string[] = []
    const files: string[] = []

    for (const dir of SCAN_DIRS) {
      const full = path.join(process.cwd(), dir)
      try {
        walk(full, files)
      } catch {
        // Directory might not exist in all checkout shapes; skip.
        continue
      }
    }

    for (const file of files) {
      const content = readFileSync(file, 'utf-8')
      if (SUSPECT_LISTENER.test(content)) {
        offenses.push(file)
      }
      SUSPECT_LISTENER.lastIndex = 0
    }

    expect(offenses).toBeArrayOfSize(0)
  })

  test('graph:replaced emits always pass a GraphReplacedPayload', () => {
    const offenses: string[] = []
    const files: string[] = []

    for (const dir of SCAN_DIRS) {
      const full = path.join(process.cwd(), dir)
      try {
        walk(full, files)
      } catch {
        continue
      }
    }

    for (const file of files) {
      const content = readFileSync(file, 'utf-8')
      const allEmits = [...content.matchAll(/emitEditorEvent\(\s*['"]graph:replaced['"]/g)]
      const allowedEmits = [...content.matchAll(ALLOWED_EMIT)]
      if (allEmits.length !== allowedEmits.length) {
        offenses.push(file)
      }
      ALLOWED_EMIT.lastIndex = 0
    }

    expect(offenses).toBeArrayOfSize(0)
  })
})
