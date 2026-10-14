import { expect, test } from 'bun:test'

import { vectorNetworkToSVGPaths } from '#core/io/formats/svg/paths'

import type { VectorNetwork } from '@open-pencil/scene-graph'

const corner = { x: 0, y: 0 }
const line = (start: number, end: number) => ({
  start,
  end,
  tangentStart: corner,
  tangentEnd: corner
})

/** A skip-back icon: a filled triangle beside a bar, which no region encloses. */
const network: VectorNetwork = {
  vertices: [
    { x: 19, y: 20 },
    { x: 9, y: 12 },
    { x: 19, y: 4 },
    { x: 5, y: 19 },
    { x: 5, y: 5 }
  ],
  segments: [line(0, 1), line(1, 2), line(2, 0), line(3, 4)],
  regions: [{ windingRule: 'NONZERO', loops: [[0, 1, 2]] }]
}

test('segments outside every region draw as open paths after the regions', () => {
  expect(vectorNetworkToSVGPaths(network)).toEqual(['M19 20L9 12L19 4L19 20Z', 'M5 19L5 5'])
})

test('a network with regions only draws the regions', () => {
  expect(vectorNetworkToSVGPaths({ ...network, segments: network.segments.slice(0, 3) })).toEqual(
    ['M19 20L9 12L19 4L19 20Z']
  )
})
