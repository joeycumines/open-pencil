export function bearerToken(header: string | undefined | null): string | null {
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null
}

export function mcpRequestToken(
  authorization: string | undefined | null,
  headerToken: string | undefined | null
): string | null {
  return bearerToken(authorization) ?? headerToken ?? null
}

import { timingSafeEqual } from 'node:crypto'

// Fixed buffer size for constant-time comparison.
// Tokens are typically 32 hex chars (128 bits), but custom tokens may differ.
// Using a fixed size ensures the comparison always takes the same time
// regardless of token length, preventing timing leaks.
const AUTH_BUFFER_SIZE = 256

export function isAuthorized(provided: string | null, expected: string | null): boolean {
  if (expected === null) return true
  if (provided === null) return false

  // Pad both strings to a fixed buffer size so comparison is constant-time.
  // Any input longer than AUTH_BUFFER_SIZE is truncated, which means very
  // long tokens (>256 UTF-8 bytes) may compare incorrectly — but the auto-
  // generated token is 32 hex chars (well within limits).
  const a = Buffer.alloc(AUTH_BUFFER_SIZE, 0)
  const b = Buffer.alloc(AUTH_BUFFER_SIZE, 0)
  a.write(provided.slice(0, AUTH_BUFFER_SIZE), 'utf-8')
  b.write(expected.slice(0, AUTH_BUFFER_SIZE), 'utf-8')
  return timingSafeEqual(a, b)
}
