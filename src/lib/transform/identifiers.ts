/**
 * Deterministic identifier generation.
 *
 * - `uuidv4()` prefers `crypto.randomUUID()` in modern browsers / Node 20+ and
 *   falls back to a bits-equivalent construction when running inside a
 *   stripped runtime (tests under old Node, etc).
 * - `stableHashId(seed)` returns a short, repeatable base36 digest — used for
 *   deterministic SQL `leads_id` values so a dry-run and a re-run produce the
 *   same manifest and the operator can reconcile batches by diffing IDs.
 */

export function uuidv4(): string {
  const g = globalThis as unknown as {
    crypto?: { randomUUID?: () => string }
  }
  if (typeof g.crypto?.randomUUID === 'function') {
    return g.crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  const c = g.crypto as unknown as {
    getRandomValues?: (b: Uint8Array) => Uint8Array
  }
  if (c?.getRandomValues) {
    c.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`
}

export function stableHashId(seed: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x1b873593
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'))
}

export function stableUuid(seed: string): string {
  const hex = stableHashId(seed) + stableHashId(seed + ':2')
  const bytes = hex.slice(0, 32)
  const b7 = (parseInt(bytes.slice(12, 14), 16) & 0x0f) | 0x40
  const b9 = (parseInt(bytes.slice(16, 18), 16) & 0x3f) | 0x80
  const patched =
    bytes.slice(0, 12) +
    b7.toString(16).padStart(2, '0') +
    bytes.slice(14, 16) +
    b9.toString(16).padStart(2, '0') +
    bytes.slice(18)
  return `${patched.slice(0, 8)}-${patched.slice(8, 12)}-${patched.slice(
    12,
    16,
  )}-${patched.slice(16, 20)}-${patched.slice(20, 32)}`
}

export function newRunId(prefix = 'RUN'): string {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .toUpperCase()
    .padStart(4, '0')
  return `${prefix}-${ts}-${rand}`
}

export function newBatchId(runId: string, index: number): string {
  return `${runId}-B${String(index + 1).padStart(3, '0')}`
}
