/**
 * Complexity regression test helpers.
 *
 * These helpers run a function at multiple scales and assert that the
 * timing grows sub-quadratically. An O(n²) regression would produce a
 * time ratio ~10× when the input grows 10×, while a linear or O(n log n)
 * path stays well below the threshold.
 *
 * Usage:
 *   const results = await runAtScales([1000, 10_000, 50_000], (n) => {
 *     // ... operation to measure ...
 *   })
 *   assertSubQuadratic(results)
 */

export interface TimingResult {
  /** Input scale (n). */
  n: number
  /** Elapsed time in milliseconds. */
  ms: number
}

/**
 * Run `fn` at each scale in `scales`. Each scale is run once (no warmup
 * — we want wall-clock regression detection, not micro-benchmark
 * precision). The function receives `n` and should perform exactly `n`
 * units of work.
 */
export function runAtScales(scales: readonly number[], fn: (n: number) => void): TimingResult[] {
  const results: TimingResult[] = []
  for (const n of scales) {
    const start = performance.now()
    fn(n)
    const ms = performance.now() - start
    results.push({ n, ms })
  }
  return results
}

/**
 * Assert that timing grows sub-quadratically across consecutive scale
 * pairs.
 *
 * For each pair (n₁, n₂) where n₂ > n₁, the ratio `ms₂/ms₁` should be
 * less than `threshold × (n₂/n₁)`. For O(n²), the ratio would be
 * `(n₂/n₁)²`, so the default threshold of 3.0 catches quadratic
 * regressions when the scale factor is ≥ 3 (9× time for 3× input →
 * ratio/n_ratio = 3.0). For O(n), the ratio/n_ratio is ~1.0.
 *
 * @param threshold Maximum allowed `time_ratio / n_ratio`. Default 3.0.
 * @throws Error if any pair exceeds the threshold.
 */
export function assertSubQuadratic(results: TimingResult[], threshold = 3.0): void {
  for (let i = 1; i < results.length; i++) {
    const prev = results[i - 1]
    const curr = results[i]
    if (prev.ms < 0.01) continue // Skip noisy micro-timings
    const nRatio = curr.n / prev.n
    const timeRatio = curr.ms / prev.ms
    const scaledRatio = timeRatio / nRatio
    if (scaledRatio > threshold) {
      throw new Error(
        `Sub-quadratic violation at scale ${prev.n}→${curr.n}: ` +
          `time ratio ${timeRatio.toFixed(2)}× / n ratio ${nRatio.toFixed(2)}× = ` +
          `${scaledRatio.toFixed(2)} > threshold ${threshold} ` +
          `(prev ${prev.ms.toFixed(2)}ms → curr ${curr.ms.toFixed(2)}ms)`
      )
    }
  }
}
