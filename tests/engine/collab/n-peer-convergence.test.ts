import { describe, expect, test } from 'bun:test'

import { createPeerMesh } from '#tests/helpers/peer-mesh'

describe('N-peer collaboration convergence', () => {
  test('fresh joiner adopts host document without retaining local default page', () => {
    const mesh = createPeerMesh(2)
    const joinerOriginalPageId = mesh.peers[1].store.state.currentPageId
    mesh.peers[1].store.graph.createNode('RECTANGLE', joinerOriginalPageId, {
      name: 'Joiner Local Draft',
      width: 25,
      height: 25
    })

    const hostPage = mesh.peers[0].store.graph.getPages()[0]
    mesh.peers[0].store.graph.createNode('RECTANGLE', hostPage.id, {
      name: 'Host Canonical Rect',
      width: 100,
      height: 100
    })

    mesh.peers[0].sync.syncAllNodesToYjs()
    mesh.syncFullMesh()

    const hostPages = mesh.peers[0].store.graph.getPages()
    const joinerPages = mesh.peers[1].store.graph.getPages()
    const adoptedHostPage = mesh.findHostPage(1)

    expect(joinerPages).toHaveLength(hostPages.length)
    expect(joinerPages.some((page) => page.id === joinerOriginalPageId)).toBe(false)
    expect(adoptedHostPage).toBeDefined()
    expect(mesh.peers[1].store.state.currentPageId).toBe(adoptedHostPage?.id)

    const joinerNodeNames = [...mesh.peers[1].store.graph.getAllNodes()].map((node) => node.name)
    expect(joinerNodeNames).toContain('Host Canonical Rect')
    expect(joinerNodeNames).not.toContain('Joiner Local Draft')

    mesh.dispose()
  })

  test('3-peer convergence: all peers see the same nodes after full mesh sync', () => {
    const mesh = createPeerMesh(3)

    // Host creates a node
    const hostPage = mesh.peers[0].store.graph.getPages()[0]
    mesh.peers[0].store.graph.createNode('RECTANGLE', hostPage.id, {
      name: 'Shared Rect',
      width: 100,
      height: 100
    })

    // Host syncs all nodes to Yjs
    mesh.peers[0].sync.syncAllNodesToYjs()

    // Full mesh sync — all peers should converge
    mesh.syncFullMesh()

    // All peers should have the same node count
    mesh.assertNodeCountConverged()

    // All peers should have the same stable IDs
    mesh.assertStableIdsConverged()

    // Verify the node exists on all peers
    for (const peer of mesh.peers) {
      const nodes = [...peer.store.graph.nodes.values()].filter((n) => n.name === 'Shared Rect')
      expect(nodes.length).toBe(1)
      expect(nodes[0]?.type).toBe('RECTANGLE')
    }

    mesh.dispose()
  })

  test('3 peers each create different nodes and converge', () => {
    const mesh = createPeerMesh(3)

    // Host syncs initial state so joiners have the host's page
    mesh.peers[0].sync.syncAllNodesToYjs()
    mesh.syncFullMesh()

    // Peer 0 creates a node on the host's page
    const page0 = mesh.peers[0].store.graph.getPages()[0]
    const peer0Node = mesh.peers[0].store.graph.createNode('RECTANGLE', page0.id, {
      name: 'Peer0 Node',
      width: 50,
      height: 50
    })
    mesh.peers[0].sync.syncNodeToYjs(peer0Node.id)

    // Peer 1 creates a different node on the HOST's page (not joiner's own page)
    const hostPageOnPeer1 = mesh.findHostPage(1)
    expect(hostPageOnPeer1).toBeDefined()
    const peer1Node = mesh.peers[1].store.graph.createNode('ELLIPSE', hostPageOnPeer1?.id ?? '', {
      name: 'Peer1 Node',
      width: 80,
      height: 80
    })
    mesh.peers[1].sync.syncNodeToYjs(peer1Node.id)

    // Full mesh sync
    mesh.syncFullMesh()

    // All peers should converge
    mesh.assertNodeCountConverged()
    mesh.assertStableIdsConverged()

    mesh.dispose()
  })

  test('network partition recovery: partitioned peers converge on reconnect', () => {
    const mesh = createPeerMesh(2)

    // Host creates initial content and syncs
    const hostPage = mesh.peers[0].store.graph.getPages()[0]
    mesh.peers[0].store.graph.createNode('RECTANGLE', hostPage.id, {
      name: 'Initial',
      width: 100,
      height: 100
    })
    mesh.peers[0].sync.syncAllNodesToYjs()
    mesh.syncFullMesh()

    // Disconnect peer 1
    mesh.disconnect(1)

    // Both peers edit independently on the HOST's page
    mesh.peers[0].store.graph.createNode('FRAME', hostPage.id, {
      name: 'Host During Partition',
      width: 50,
      height: 50
    })
    mesh.peers[0].sync.syncAllNodesToYjs()

    // Joiner uses the host's page (received during initial sync), not its own
    const joinerHostPage = mesh.findHostPage(1)
    expect(joinerHostPage).toBeDefined()
    mesh.peers[1].store.graph.createNode('ELLIPSE', joinerHostPage?.id ?? '', {
      name: 'Joiner During Partition',
      width: 60,
      height: 60
    })
    mesh.peers[1].sync.syncAllNodesToYjs()

    // Reconnect and sync
    mesh.reconnect(1)
    mesh.syncFullMesh()

    // Both peers should converge
    mesh.assertNodeCountConverged()
    mesh.assertStableIdsConverged()

    // Both peers should have nodes from both sides of the partition
    for (const peer of mesh.peers) {
      const names = [...peer.store.graph.nodes.values()].map((n) => n.name)
      expect(names).toContain('Host During Partition')
      expect(names).toContain('Joiner During Partition')
    }

    mesh.dispose()
  })

  test('component and instance sync across peers', () => {
    const mesh = createPeerMesh(2)

    // Host creates a component with a child
    const hostPage = mesh.peers[0].store.graph.getPages()[0]
    const component = mesh.peers[0].store.graph.createNode('COMPONENT', hostPage.id, {
      name: 'Button',
      width: 120,
      height: 40
    })
    mesh.peers[0].store.graph.createNode('RECTANGLE', component.id, {
      name: 'Button Bg',
      width: 120,
      height: 40
    })

    // Host creates an instance of the component.
    // NOTE: We do NOT call populateInstanceChildren before syncing.
    // Instance children share the same stable ID as their component
    // counterparts (by design — for override mapping). If synced via
    // Yjs, the stable ID collision would overwrite the component's
    // original child. Each peer creates instance children locally
    // (auto-populated in applyNewNodeCreate when an INSTANCE arrives).
    mesh.peers[0].store.graph.createNode('INSTANCE', hostPage.id, {
      name: 'Button Instance',
      width: 120,
      height: 40,
      componentId: component.id,
      x: 200,
      y: 0
    })

    // Host syncs to Yjs
    mesh.peers[0].sync.syncAllNodesToYjs()
    mesh.syncFullMesh()

    // Joiner should have the component and instance
    mesh.assertNodeCountConverged()
    mesh.assertStableIdsConverged()

    // Verify instance exists on joiner
    const joinerNodes = [...mesh.peers[1].store.graph.nodes.values()]
    const instance = joinerNodes.find((n) => n.type === 'INSTANCE')
    expect(instance).toBeDefined()
    expect(instance?.name).toBe('Button Instance')

    // Verify component exists on joiner
    const comp = joinerNodes.find((n) => n.type === 'COMPONENT')
    expect(comp).toBeDefined()
    expect(comp?.name).toBe('Button')

    // Verify instance was auto-populated with children on joiner
    expect(instance?.childIds.length).toBeGreaterThan(0)

    mesh.dispose()
  })

  test('variable and binding sync across peers', () => {
    const mesh = createPeerMesh(2)

    // Host creates a variable collection and variable
    const collection = mesh.peers[0].store.graph.createCollection('Colors')
    const variable = mesh.peers[0].store.graph.createVariable('Primary', 'COLOR', collection.id, {
      r: 0,
      g: 1,
      b: 0,
      a: 1
    })

    // Host creates a node with a bound variable
    const hostPage = mesh.peers[0].store.graph.getPages()[0]
    mesh.peers[0].store.graph.createNode('RECTANGLE', hostPage.id, {
      name: 'Themed Rect',
      width: 100,
      height: 100,
      fills: [
        {
          type: 'SOLID',
          color: { r: 0, g: 1, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          blendMode: 'NORMAL'
        }
      ],
      boundVariables: { fills: variable.id }
    })

    // Host syncs to Yjs
    mesh.peers[0].sync.syncAllNodesToYjs()
    mesh.syncFullMesh()

    // Joiner should have the variable and collection
    expect(mesh.peers[1].store.graph.variables.size).toBe(1)
    expect(mesh.peers[1].store.graph.variableCollections.size).toBe(1)

    // Joiner should have the node with the binding resolved
    const joinerNodes = [...mesh.peers[1].store.graph.nodes.values()].filter(
      (n) => n.name === 'Themed Rect'
    )
    expect(joinerNodes.length).toBe(1)

    const boundVarId = joinerNodes[0]?.boundVariables.fills
    expect(boundVarId).toBeDefined()
    expect(mesh.peers[1].store.graph.variables.has(boundVarId as string)).toBe(true)

    mesh.dispose()
  })

  test('image fill sync across peers', () => {
    const mesh = createPeerMesh(2)

    // Host creates an image hash and data
    const imageHash = 'test-image-hash-123'
    const imageData = new Uint8Array([1, 2, 3, 4, 5])
    mesh.peers[0].store.graph.images.set(imageHash, imageData)

    // Host creates a node with an image fill
    const hostPage = mesh.peers[0].store.graph.getPages()[0]
    mesh.peers[0].store.graph.createNode('RECTANGLE', hostPage.id, {
      name: 'Image Rect',
      width: 200,
      height: 150,
      fills: [
        {
          type: 'IMAGE',
          color: { r: 0, g: 0, b: 0, a: 0 },
          opacity: 1,
          visible: true,
          blendMode: 'NORMAL',
          imageHash,
          imageScaleMode: 'FILL'
        }
      ]
    })

    // Host syncs to Yjs (including images)
    mesh.peers[0].sync.syncAllNodesToYjs()
    mesh.syncFullMesh()

    // Joiner should have the image data
    expect(mesh.peers[1].store.graph.images.has(imageHash)).toBe(true)
    const joinerImageData = mesh.peers[1].store.graph.images.get(imageHash)
    expect(joinerImageData).toBeDefined()
    expect(joinerImageData?.length).toBe(imageData.length)

    mesh.dispose()
  })
})
