import * as v from 'valibot'

/**
 * Official releases are stable `x.y.z` or a beta pre-release `x.y.z-beta.N`. One numbered
 * channel keeps the MSI version, whose only free field is a number, unambiguous.
 */
const RELEASE_VERSION = String.raw`(\d+)\.(\d+)\.(\d+)(?:-beta\.([1-9]\d{0,3}))?`

export const releaseVersionSchema = v.pipe(v.string(), v.regex(new RegExp(`^${RELEASE_VERSION}$`)))
export const releaseTagSchema = v.pipe(v.string(), v.regex(new RegExp(`^v${RELEASE_VERSION}$`)))

/** npm dist-tag for pre-releases; stable releases keep npm's default `latest`. */
export const PRERELEASE_DIST_TAG = 'next'

export function isPrerelease(version: string): boolean {
  return v.parse(releaseVersionSchema, version).includes('-')
}

/**
 * WiX accepts only numeric `major.minor.patch.build` versions, so `x.y.z-beta.N` installs as
 * `x.y.z.N`. Windows Installer ignores that fourth field, but Tauri gives every MSI a new
 * product code and a major upgrade that allows downgrades, so a later beta and the final
 * `x.y.z` still replace an installed beta.
 */
export function msiVersion(version: string): string | undefined {
  const [, major, minor, patch, beta] =
    new RegExp(`^${RELEASE_VERSION}$`).exec(v.parse(releaseVersionSchema, version)) ?? []
  return beta ? `${major}.${minor}.${patch}.${beta}` : undefined
}
