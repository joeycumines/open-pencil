import type { VectorSegment, VectorVertex } from '@open-pencil/scene-graph'

/** Anything path commands can be emitted into: a canvaskit Path or a blob encoder. */
export interface PathSink {
  moveTo(x: number, y: number): unknown
  lineTo(x: number, y: number): unknown
  cubicTo(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): unknown
  close(): unknown
}

export function addSegmentDirected(
  path: PathSink,
  seg: VectorSegment,
  vertices: VectorVertex[],
  forward: boolean
): void {
  const p0 = forward ? vertices[seg.start] : vertices[seg.end]
  const p3 = forward ? vertices[seg.end] : vertices[seg.start]
  const ts = seg.tangentStart
  const te = seg.tangentEnd

  const isLine = ts.x === 0 && ts.y === 0 && te.x === 0 && te.y === 0
  if (isLine) {
    path.lineTo(p3.x, p3.y)
  } else if (forward) {
    path.cubicTo(p0.x + ts.x, p0.y + ts.y, p3.x + te.x, p3.y + te.y, p3.x, p3.y)
  } else {
    path.cubicTo(p0.x + te.x, p0.y + te.y, p3.x + ts.x, p3.y + ts.y, p3.x, p3.y)
  }
}

export function findChainStart(chain: number[], segments: VectorSegment[]): number {
  if (chain.length < 2) return segments[chain[0]].start

  const first = segments[chain[0]]
  const second = segments[chain[1]]
  if (first.start === second.start || first.start === second.end) return first.end
  return first.start
}

export function addLoopToPath(
  path: PathSink,
  loop: number[],
  segments: VectorSegment[],
  vertices: VectorVertex[]
): void {
  if (loop.length === 0) return

  const firstSeg = segments[loop[0]]

  // Determine the starting vertex — if the loop has multiple segments,
  // the first segment's direction is determined by which vertex connects
  // to the second segment.
  let current: number
  if (loop.length === 1) {
    current = firstSeg.start
  } else {
    const secondSeg = segments[loop[1]]
    if (firstSeg.end === secondSeg.start || firstSeg.end === secondSeg.end) {
      current = firstSeg.start
    } else {
      current = firstSeg.end
    }
  }

  path.moveTo(vertices[current].x, vertices[current].y)

  for (const segIdx of loop) {
    const seg = segments[segIdx]
    const forward = seg.start === current
    addSegmentDirected(path, seg, vertices, forward)
    current = forward ? seg.end : seg.start
  }

  path.close()
}

export function addOpenSegmentsToPath(
  path: PathSink,
  segments: VectorSegment[],
  vertices: VectorVertex[]
): void {
  const visited = new Set<number>()
  const chains = buildChains(segments)

  for (const chain of chains) {
    if (chain.length === 0) continue
    let current = findChainStart(chain, segments)
    path.moveTo(vertices[current].x, vertices[current].y)
    for (const segIdx of chain) {
      visited.add(segIdx)
      const seg = segments[segIdx]
      const forward = seg.start === current
      addSegmentDirected(path, seg, vertices, forward)
      current = forward ? seg.end : seg.start
    }
  }

  for (let i = 0; i < segments.length; i++) {
    if (visited.has(i)) continue
    const seg = segments[i]
    path.moveTo(vertices[seg.start].x, vertices[seg.start].y)
    addSegmentDirected(path, seg, vertices, true)
  }
}

export function buildChains(segments: VectorSegment[]): number[][] {
  if (segments.length === 0) return []

  const adj = new Map<number, number[]>()
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]
    const startList = adj.get(s.start) ?? []
    startList.push(i)
    adj.set(s.start, startList)

    const endList = adj.get(s.end) ?? []
    endList.push(i)
    adj.set(s.end, endList)
  }

  const visited = new Set<number>()
  const chains: number[][] = []
  const degree1 = [...adj.entries()].filter(([, segs]) => segs.length === 1).map(([v]) => v)
  const startVertices = degree1.length > 0 ? degree1 : [segments[0].start]

  for (const startVertex of startVertices) {
    let current = startVertex
    const chain: number[] = []

    for (;;) {
      const segs = adj.get(current)
      if (!segs) break

      const nextSeg = segs.find((s) => !visited.has(s))
      if (nextSeg === undefined) break

      visited.add(nextSeg)
      chain.push(nextSeg)

      const seg = segments[nextSeg]
      current = seg.start === current ? seg.end : seg.start
    }

    if (chain.length > 0) chains.push(chain)
  }

  return chains
}

/** A stretch of a network's segments stroked as one contour, so its corners join. */
export interface StrokeRun {
  /** The vertex the run starts at. */
  start: number
  /** Segment indices in drawing order. */
  segments: number[]
  /** Whether the run comes back to its start, joining there instead of taking caps. */
  closed: boolean
}

/**
 * Segments chained into runs as Figma strokes a network: a run passes through every vertex
 * exactly two segments meet at, so its corners take the stroke's join and only its open ends take
 * caps. Runs stop at open ends and at junctions where three or more segments meet.
 */
export function strokeRuns(segments: VectorSegment[]): StrokeRun[] {
  const incident = new Map<number, number[]>()
  const meet = (vertex: number, index: number) => {
    const list = incident.get(vertex)
    if (list) list.push(index)
    else incident.set(vertex, [index])
  }
  for (const [index, segment] of segments.entries()) {
    meet(segment.start, index)
    if (segment.end !== segment.start) meet(segment.end, index)
  }
  const used = new Set<number>()
  const across = (index: number, vertex: number) =>
    segments[index].start === vertex ? segments[index].end : segments[index].start
  /** Extends a run through `vertex` for as long as two segments meet at each vertex reached. */
  const extend = (vertex: number, from: number, add: (index: number) => void) => {
    for (;;) {
      const meeting = incident.get(vertex)
      if (meeting?.length !== 2) return vertex
      const next = meeting[0] === from ? meeting[1] : meeting[0]
      if (used.has(next)) return vertex
      used.add(next)
      add(next)
      vertex = across(next, vertex)
      from = next
    }
  }

  const runs: StrokeRun[] = []
  for (const [first, segment] of segments.entries()) {
    if (used.has(first)) continue
    used.add(first)
    const run = [first]
    const end = extend(segment.end, first, (index) => run.push(index))
    if (end === segment.start) {
      runs.push({ start: segment.start, segments: run, closed: true })
      continue
    }
    const start = extend(segment.start, first, (index) => run.unshift(index))
    // A loop through a junction stops at it from both sides; it still closes there, whichever
    // of its segments is stored first.
    runs.push({ start, segments: run, closed: start === end })
  }
  return runs
}

/** Emits a stroke run as one contour, closed when the run comes back to its start. */
export function addStrokeRunToPath(
  path: PathSink,
  run: StrokeRun,
  segments: VectorSegment[],
  vertices: VectorVertex[]
): void {
  let current = run.start
  path.moveTo(vertices[current].x, vertices[current].y)
  for (const index of run.segments) {
    const segment = segments[index]
    const forward = segment.start === current
    addSegmentDirected(path, segment, vertices, forward)
    current = forward ? segment.end : segment.start
  }
  if (run.closed) path.close()
}
