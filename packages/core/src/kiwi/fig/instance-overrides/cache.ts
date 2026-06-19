import type { OverrideContext } from './types'

let siblingIndexCache = new WeakMap<OverrideContext, Map<string, number | null>>()
let siblingGroupCache = new WeakMap<OverrideContext, Map<string, string[]>>()
let candidateCache = new WeakMap<OverrideContext, Map<string, string[]>>()
let componentFindCache = new WeakMap<OverrideContext, Map<string, string | null>>()

export function clearInstanceOverrideCaches(ctx?: OverrideContext): void {
  if (ctx) {
    siblingIndexCache.delete(ctx)
    siblingGroupCache.delete(ctx)
    candidateCache.delete(ctx)
    componentFindCache.delete(ctx)
    return
  }
  siblingIndexCache = new WeakMap()
  siblingGroupCache = new WeakMap()
  candidateCache = new WeakMap()
  componentFindCache = new WeakMap()
}

export function getSiblingIndexCache(ctx: OverrideContext): Map<string, number | null> | undefined {
  return siblingIndexCache.get(ctx)
}

export function setSiblingIndexCache(
  ctx: OverrideContext,
  cache: Map<string, number | null>
): void {
  siblingIndexCache.set(ctx, cache)
}

export function getSiblingGroupCache(ctx: OverrideContext): Map<string, string[]> | undefined {
  return siblingGroupCache.get(ctx)
}

export function setSiblingGroupCache(ctx: OverrideContext, cache: Map<string, string[]>): void {
  siblingGroupCache.set(ctx, cache)
}

export function getCandidateCache(ctx: OverrideContext): Map<string, string[]> | undefined {
  return candidateCache.get(ctx)
}

export function setCandidateCache(ctx: OverrideContext, cache: Map<string, string[]>): void {
  candidateCache.set(ctx, cache)
}

export function getComponentFindCache(
  ctx: OverrideContext
): Map<string, string | null> | undefined {
  return componentFindCache.get(ctx)
}

export function setComponentFindCache(
  ctx: OverrideContext,
  cache: Map<string, string | null>
): void {
  componentFindCache.set(ctx, cache)
}
