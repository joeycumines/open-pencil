import type { GUID, NodeChange } from '@open-pencil/core'

export function guid(sessionID: number, localID: number): GUID {
  return { sessionID, localID }
}

export function guidString(value: GUID | undefined): string | undefined {
  return value ? `${value.sessionID}:${value.localID}` : undefined
}

export function minimalDocumentTree(sessionID = 10, localIDOffset = 0): NodeChange[] {
  return [
    {
      guid: { sessionID, localID: localIDOffset },
      type: 'DOCUMENT',
      name: 'Document',
      visible: true,
      opacity: 1,
      phase: 'CREATED',
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
    },
    {
      guid: { sessionID, localID: localIDOffset + 1 },
      parentIndex: {
        guid: { sessionID, localID: localIDOffset },
        position: '!'
      },
      type: 'CANVAS',
      name: 'Page',
      visible: true,
      opacity: 1,
      phase: 'CREATED',
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
    }
  ] as NodeChange[]
}
