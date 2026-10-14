import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { assembleUnreleased, readFragments } from './fragments'
import { unreleasedContentLine, validateChangelog } from './validate'

// `--release` allows entries under Unreleased while a release curates them after
// `changelog:assemble`; without it, they belong in fragments.
const args = process.argv.slice(2)
const release = args.includes('--release')
const root = resolve(args.find((arg) => !arg.startsWith('--')) ?? '.')
const changelogPath = resolve(root, 'CHANGELOG.md')

const { fragments, errors: fragmentErrors } = await readFragments(resolve(root, 'changes'))
// Validated as it will read once the fragments are assembled, so duplicates across pull
// requests and fragments in an empty category are caught now rather than at release.
const changelog = await readFile(changelogPath, 'utf8')
const { errors: changelogErrors } = validateChangelog(assembleUnreleased(changelog, fragments))
const errors = [...fragmentErrors, ...changelogErrors]

const pending = release ? null : unreleasedContentLine(changelog)
if (pending !== null) {
  errors.unshift(
    `CHANGELOG.md line ${pending}: Unreleased stays empty; move the entry into changes/<PR>/<category>.md (changes/README.md).`
  )
}

if (errors.length > 0) {
  process.stderr.write(
    `Changelog validation failed:\n${errors.map((error) => `- ${error}`).join('\n')}\n`
  )
  process.exit(1)
}

process.stdout.write(
  `Changelog validation passed: ${changelogPath} and ${fragments.length} fragments in changes/\n`
)
