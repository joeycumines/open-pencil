import { expect, test } from 'bun:test'

import { isPrerelease, msiVersion } from '#release/version'

test.each([
  ['0.16.0', false, undefined],
  ['0.16.0-beta.1', true, '0.16.0.1'],
  ['1.2.3-beta.42', true, '1.2.3.42']
])('release version %s', (version, prerelease, msi) => {
  expect(isPrerelease(version)).toBe(prerelease)
  expect(msiVersion(version)).toBe(msi)
})

test.each(['0.16.0-rc.1', '0.16.0-beta', '0.16.0-beta.0', '0.16.0-beta.01', '0.16.0-1', '0.16'])(
  'rejects unsupported release version %s',
  (version) => {
    expect(() => isPrerelease(version)).toThrow()
  }
)
