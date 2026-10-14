import { describe, expect, test } from 'bun:test'

import { restartFixesMCPFailure, type MCPFailureCode } from '@/app/automation/mcp/failure'

describe('restartFixesMCPFailure', () => {
  test.each<[MCPFailureCode, boolean]>([
    ['rejected', true],
    ['timeout', true],
    ['exited', true],
    ['malformed', true],
    ['unreachable', true],
    ['unknown', true],
    // Installing or updating fixes these, and restarts the server itself.
    ['not-installed', false],
    ['outdated', false],
    // The system refuses the command; restarting would fail the same way.
    ['permission-denied', false]
  ])('%s → %p', (code, fixes) => {
    expect(restartFixesMCPFailure({ code })).toBe(fixes)
  })
})
