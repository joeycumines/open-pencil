import { describe, expect, test } from 'bun:test'

import type { GUID, NodeChange, Paint } from '@open-pencil/core'
import { remapNodeChangeReferences } from '@open-pencil/core/kiwi/fig/guid-remap'

import { guid, guidString } from '../helpers'

type GuidReference = { guid: GUID }

type DeepAssignment = {
  defID: GUID
  value: { guidValue: GUID }
  varValue: { value: { symbolIdValue: GuidReference } }
}

type DeepEffect = {
  id: GUID
  customEffectId: GuidReference
  colorVar: { value: { alias: GuidReference } }
  radiusVar: { value: { alias: GuidReference } }
  componentPropAssignments: DeepAssignment[]
}

type DeepPaint = Paint & {
  id: GUID
  sourceNodeId: GUID
  customEffectId?: GuidReference
  colorVariableBinding?: { variableID: GUID }
  opacityVar: { value: { alias: GuidReference } }
  colorVar: { value: { alias: GuidReference } }
  imageVar: { value: { alias: GuidReference } }
  stopsVar: Array<{ colorVar: { value: { alias: GuidReference } } }>
  componentPropAssignments: DeepAssignment[]
}

type DeepSymbolOverride = {
  guidPath: { guids: GUID[] }
  overriddenSymbolID: GUID
  componentPropAssignments: DeepAssignment[]
  variableConsumptionMap: {
    entries: Array<{ variableData: { value: { alias: GuidReference } } }>
  }
  styleIdForFill: GuidReference
  fillPaints: Array<
    DeepPaint & {
      customEffectId: GuidReference
      colorVariableBinding: { variableID: GUID }
    }
  >
  effects: DeepEffect[]
}

type DeepStyleOverride = NodeChange & {
  styleIdForFill: GuidReference
  fillPaints: Array<Paint & { sourceNodeId: GUID }>
}

type DeepLayoutGrid = {
  numSectionsVar: { value: { alias: GuidReference } }
  offsetVar: { value: { alias: GuidReference } }
  sectionSizeVar: { value: { alias: GuidReference } }
  gutterSizeVar: { value: { alias: GuidReference } }
}

type DeepPrototypeAction = {
  transitionNodeID: GUID
  linkParam: { value: { alias: GuidReference } }
  cmsTarget: { nodeId: GUID }
  targetVariableID: GUID
  targetVariableValue: { alias: GuidReference }
  targetVariable: { id: GuidReference }
  targetVariableData: { value: { alias: GuidReference } }
  conditions: Array<{ value: { alias: GuidReference } }>
  conditionalActions: Array<{
    condition: { value: { alias: GuidReference } }
    actions: Array<{ transitionNodeID: GUID }>
  }>
  targetVariableSetID: GuidReference
  targetVariableModeID: GUID
  variableSetTargetExtensionId: GuidReference
  animationTargetId: GUID
  animationTimelineDefId: GUID
}

type DeepPrototypeInteraction = {
  id: GUID
  actions: DeepPrototypeAction[]
}

type DeepRemappedNodeChange = NodeChange & {
  symbolData: NonNullable<NodeChange['symbolData']> & {
    symbolOverrides: DeepSymbolOverride[]
  }
  styleIdForFill: GuidReference
  styleIdForStrokeFill: GuidReference
  styleIdForText: GuidReference
  styleIdForEffect: GuidReference
  styleIdForGrid: GuidReference
  fillPaints: DeepPaint[]
  strokePaints: Array<Paint & { colorVariableBinding: { variableID: GUID } }>
  backgroundPaints: Array<Paint & { customEffectId: GuidReference }>
  textDecorationFillPaints: Array<Paint & { colorVar: { value: { alias: GuidReference } } }>
  layoutGrids: DeepLayoutGrid[]
  effects: DeepEffect[]
  textData: {
    characters: string
    styleOverrideTable: DeepStyleOverride[]
  }
  componentPropAssignments: DeepAssignment[]
  componentPropRefs: Array<{ defID: GUID }>
  componentPropDefs: Array<{
    id: GUID
    initialValue: { guidValue: GUID }
    parentPropDefId: GUID
    varValue: { value: { alias: GuidReference } }
  }>
  variantPropSpecs: Array<{ propDefId: GUID }>
  derivedSymbolData: Array<{ guidPath: { guids: GUID[] } }>
  variableSetModes: Array<{
    id: GUID
    parentVariableSetId: GuidReference
    parentModeId: GUID
  }>
  variableModeBySetMap: {
    entries: Array<{
      variableSetID: GuidReference
      variableModeID: GUID
      variableSetExtensionID: GuidReference
    }>
  }
  variableDataValues: {
    entries: Array<{ modeID: GUID; variableData: { value: { alias: GuidReference } } }>
  }
  parameterConsumptionMap: {
    entries: Array<{ variableData: { value: { alias: GuidReference } } }>
  }
  variableData: { value: { symbolIdValue: GuidReference } }
  handoffStatusMap: { entries: Array<{ guid: GUID }> }
  prototypeStartNodeID: GUID
  prototypeInteractions: DeepPrototypeInteraction[]
}

function expectDeepSymbolOverrideReferences(override: DeepSymbolOverride): void {
  expect(guidString(override.guidPath.guids[0])).toBe('99:30')
  expect(guidString(override.overriddenSymbolID)).toBe('99:40')
  expect(guidString(override.componentPropAssignments[0].defID)).toBe('99:50')
  expect(guidString(override.componentPropAssignments[0].value.guidValue)).toBe('99:40')
  expect(guidString(override.componentPropAssignments[0].varValue.value.symbolIdValue.guid)).toBe(
    '99:30'
  )
  expect(guidString(override.variableConsumptionMap.entries[0].variableData.value.alias.guid)).toBe(
    '99:60'
  )
  expect(guidString(override.styleIdForFill.guid)).toBe('99:50')
  expect(guidString(override.fillPaints[0].id)).toBe('99:30')
  expect(guidString(override.fillPaints[0].sourceNodeId)).toBe('99:30')
  expect(guidString(override.fillPaints[0].customEffectId.guid)).toBe('99:40')
  expect(guidString(override.fillPaints[0].colorVariableBinding.variableID)).toBe('99:60')
  expect(guidString(override.fillPaints[0].opacityVar.value.alias.guid)).toBe('99:60')
  expect(guidString(override.fillPaints[0].colorVar.value.alias.guid)).toBe('99:60')
  expect(guidString(override.fillPaints[0].imageVar.value.alias.guid)).toBe('99:60')
  expect(guidString(override.fillPaints[0].stopsVar[0].colorVar.value.alias.guid)).toBe('99:60')
  expect(guidString(override.fillPaints[0].componentPropAssignments[0].defID)).toBe('99:50')
  expect(guidString(override.fillPaints[0].componentPropAssignments[0].value.guidValue)).toBe(
    '99:40'
  )
  expect(
    guidString(override.fillPaints[0].componentPropAssignments[0].varValue.value.symbolIdValue.guid)
  ).toBe('99:30')
  expect(guidString(override.effects[0].id)).toBe('99:30')
  expect(guidString(override.effects[0].customEffectId.guid)).toBe('99:40')
  expect(guidString(override.effects[0].colorVar.value.alias.guid)).toBe('99:60')
  expect(guidString(override.effects[0].componentPropAssignments[0].defID)).toBe('99:50')
}

function expectDeepStyleAndPaintReferences(remapped: DeepRemappedNodeChange): void {
  expect(guidString(remapped.styleIdForFill.guid)).toBe('99:50')
  expect(guidString(remapped.styleIdForStrokeFill.guid)).toBe('99:50')
  expect(guidString(remapped.styleIdForText.guid)).toBe('99:50')
  expect(guidString(remapped.styleIdForEffect.guid)).toBe('99:50')
  expect(guidString(remapped.styleIdForGrid.guid)).toBe('99:50')
  expect(guidString(remapped.fillPaints[0].id)).toBe('99:30')
  expect(guidString(remapped.fillPaints[0].sourceNodeId)).toBe('99:30')
  expect(guidString(remapped.fillPaints[0].opacityVar.value.alias.guid)).toBe('99:60')
  expect(guidString(remapped.fillPaints[0].imageVar.value.alias.guid)).toBe('99:60')
  expect(guidString(remapped.fillPaints[0].stopsVar[0].colorVar.value.alias.guid)).toBe('99:60')
  expect(guidString(remapped.fillPaints[0].componentPropAssignments[0].defID)).toBe('99:50')
  expect(guidString(remapped.fillPaints[0].componentPropAssignments[0].value.guidValue)).toBe(
    '99:40'
  )
  expect(
    guidString(remapped.fillPaints[0].componentPropAssignments[0].varValue.value.symbolIdValue.guid)
  ).toBe('99:30')
  expect(guidString(remapped.strokePaints[0].colorVariableBinding.variableID)).toBe('99:60')
  expect(guidString(remapped.backgroundPaints[0].customEffectId.guid)).toBe('99:40')
  expect(guidString(remapped.textDecorationFillPaints[0].colorVar.value.alias.guid)).toBe('99:60')
  expect(guidString(remapped.layoutGrids[0].numSectionsVar.value.alias.guid)).toBe('99:60')
  expect(guidString(remapped.layoutGrids[0].offsetVar.value.alias.guid)).toBe('99:60')
  expect(guidString(remapped.layoutGrids[0].sectionSizeVar.value.alias.guid)).toBe('99:60')
  expect(guidString(remapped.layoutGrids[0].gutterSizeVar.value.alias.guid)).toBe('99:60')
  expect(guidString(remapped.effects[0].id)).toBe('99:30')
  expect(guidString(remapped.effects[0].customEffectId.guid)).toBe('99:40')
  expect(guidString(remapped.effects[0].radiusVar.value.alias.guid)).toBe('99:60')
  const styleOverride = remapped.textData.styleOverrideTable[0]
  expect(guidString(styleOverride.styleIdForFill.guid)).toBe('99:50')
  expect(guidString(styleOverride.fillPaints[0].sourceNodeId)).toBe('99:30')
}

function expectDeepComponentReferences(remapped: DeepRemappedNodeChange): void {
  expect(guidString(remapped.componentPropAssignments[0].defID)).toBe('99:50')
  expect(guidString(remapped.componentPropAssignments[0].value.guidValue)).toBe('99:40')
  expect(guidString(remapped.componentPropAssignments[0].varValue.value.symbolIdValue.guid)).toBe(
    '99:30'
  )
  expect(guidString(remapped.componentPropRefs[0].defID)).toBe('99:50')
  expect(guidString(remapped.componentPropDefs[0].id)).toBe('99:50')
  expect(guidString(remapped.componentPropDefs[0].initialValue.guidValue)).toBe('99:40')
  expect(guidString(remapped.componentPropDefs[0].parentPropDefId)).toBe('99:55')
  expect(guidString(remapped.componentPropDefs[0].varValue.value.alias.guid)).toBe('99:60')
  expect(guidString(remapped.variantPropSpecs[0].propDefId)).toBe('99:50')
  expect(guidString(remapped.derivedSymbolData[0].guidPath.guids[0])).toBe('99:30')
}

function expectDeepVariableReferences(remapped: DeepRemappedNodeChange): void {
  expect(guidString(remapped.variableSetModes[0].id)).toBe('99:70')
  expect(guidString(remapped.variableSetModes[0].parentVariableSetId.guid)).toBe('99:60')
  expect(guidString(remapped.variableSetModes[0].parentModeId)).toBe('99:70')
  expect(guidString(remapped.variableModeBySetMap.entries[0].variableSetID.guid)).toBe('99:60')
  expect(guidString(remapped.variableModeBySetMap.entries[0].variableModeID)).toBe('99:70')
  expect(guidString(remapped.variableModeBySetMap.entries[0].variableSetExtensionID.guid)).toBe(
    '99:60'
  )
  expect(guidString(remapped.variableDataValues.entries[0].modeID)).toBe('99:70')
  expect(guidString(remapped.variableDataValues.entries[0].variableData.value.alias.guid)).toBe(
    '99:60'
  )
  expect(
    guidString(remapped.parameterConsumptionMap.entries[0].variableData.value.alias.guid)
  ).toBe('99:60')
  expect(guidString(remapped.variableData.value.symbolIdValue.guid)).toBe('99:40')
}

function expectDeepPrototypeReferences(remapped: DeepRemappedNodeChange): void {
  expect(guidString(remapped.handoffStatusMap.entries[0].guid)).toBe('99:30')
  expect(guidString(remapped.prototypeStartNodeID)).toBe('99:30')
  expect(guidString(remapped.prototypeInteractions[0].id)).toBe('99:40')
  const action = remapped.prototypeInteractions[0].actions[0]
  expect(guidString(action.transitionNodeID)).toBe('99:30')
  expect(guidString(action.linkParam.value.alias.guid)).toBe('99:60')
  expect(guidString(action.cmsTarget.nodeId)).toBe('99:30')
  expect(guidString(action.targetVariableID)).toBe('99:60')
  expect(guidString(action.targetVariableValue.alias.guid)).toBe('99:60')
  expect(guidString(action.targetVariable.id.guid)).toBe('99:60')
  expect(guidString(action.targetVariableData.value.alias.guid)).toBe('99:60')
  expect(guidString(action.conditions[0].value.alias.guid)).toBe('99:60')
  expect(guidString(action.conditionalActions[0].condition.value.alias.guid)).toBe('99:60')
  expect(guidString(action.conditionalActions[0].actions[0].transitionNodeID)).toBe('99:40')
  expect(guidString(action.targetVariableSetID.guid)).toBe('99:60')
  expect(guidString(action.targetVariableModeID)).toBe('99:70')
  expect(guidString(action.variableSetTargetExtensionId.guid)).toBe('99:60')
  expect(guidString(action.animationTargetId)).toBe('99:30')
  expect(guidString(action.animationTimelineDefId)).toBe('99:40')
}

describe('fig import duplicate GUID deep reference-safety', () => {
  test('deep GUID payload fields remap consistently', () => {
    const remapped = remapNodeChangeReferences(
      {
        guid: guid(10, 80),
        type: 'INSTANCE',
        symbolData: {
          symbolID: guid(10, 20),
          symbolOverrides: [
            {
              guidPath: { guids: [guid(10, 30)] },
              overriddenSymbolID: guid(10, 40),
              styleIdForFill: { guid: guid(10, 50) },
              fillPaints: [
                {
                  type: 'PATTERN',
                  id: guid(10, 30),
                  sourceNodeId: guid(10, 30),
                  customEffectId: { guid: guid(10, 40) },
                  colorVariableBinding: { variableID: guid(10, 60) },
                  opacityVar: { value: { alias: { guid: guid(10, 60) } } },
                  colorVar: { value: { alias: { guid: guid(10, 60) } } },
                  imageVar: { value: { alias: { guid: guid(10, 60) } } },
                  stopsVar: [
                    { colorVar: { value: { alias: { guid: guid(10, 60) } } }, position: 0 }
                  ],
                  componentPropAssignments: [
                    {
                      defID: guid(10, 50),
                      value: { guidValue: guid(10, 40) },
                      varValue: { value: { symbolIdValue: { guid: guid(10, 30) } } }
                    }
                  ]
                }
              ],
              effects: [
                {
                  type: 'DROP_SHADOW',
                  id: guid(10, 30),
                  customEffectId: { guid: guid(10, 40) },
                  colorVar: { value: { alias: { guid: guid(10, 60) } } },
                  componentPropAssignments: [
                    {
                      defID: guid(10, 50),
                      value: { guidValue: guid(10, 40) },
                      varValue: { value: { symbolIdValue: { guid: guid(10, 30) } } }
                    }
                  ]
                }
              ],
              componentPropAssignments: [
                {
                  defID: guid(10, 50),
                  value: { guidValue: guid(10, 40) },
                  varValue: { value: { symbolIdValue: { guid: guid(10, 30) } } }
                }
              ],
              variableConsumptionMap: {
                entries: [{ variableData: { value: { alias: { guid: guid(10, 60) } } } }]
              }
            }
          ]
        },
        styleIdForFill: { guid: guid(10, 50) },
        styleIdForStrokeFill: { guid: guid(10, 50) },
        styleIdForText: { guid: guid(10, 50) },
        styleIdForEffect: { guid: guid(10, 50) },
        styleIdForGrid: { guid: guid(10, 50) },
        fillPaints: [
          {
            type: 'PATTERN',
            id: guid(10, 30),
            sourceNodeId: guid(10, 30),
            opacityVar: { value: { alias: { guid: guid(10, 60) } } },
            colorVar: { value: { alias: { guid: guid(10, 60) } } },
            imageVar: { value: { alias: { guid: guid(10, 60) } } },
            stopsVar: [{ colorVar: { value: { alias: { guid: guid(10, 60) } } }, position: 0 }],
            componentPropAssignments: [
              {
                defID: guid(10, 50),
                value: { guidValue: guid(10, 40) },
                varValue: { value: { symbolIdValue: { guid: guid(10, 30) } } }
              }
            ]
          }
        ],
        strokePaints: [{ type: 'SOLID', colorVariableBinding: { variableID: guid(10, 60) } }],
        backgroundPaints: [{ type: 'CUSTOM', customEffectId: { guid: guid(10, 40) } }],
        textDecorationFillPaints: [
          { type: 'SOLID', colorVar: { value: { alias: { guid: guid(10, 60) } } } }
        ],
        layoutGrids: [
          {
            type: 'GRID',
            numSectionsVar: { value: { alias: { guid: guid(10, 60) } } },
            offsetVar: { value: { alias: { guid: guid(10, 60) } } },
            sectionSizeVar: { value: { alias: { guid: guid(10, 60) } } },
            gutterSizeVar: { value: { alias: { guid: guid(10, 60) } } }
          }
        ],
        effects: [
          {
            type: 'DROP_SHADOW',
            id: guid(10, 30),
            customEffectId: { guid: guid(10, 40) },
            radiusVar: { value: { alias: { guid: guid(10, 60) } } }
          }
        ],
        textData: {
          characters: 'styled',
          styleOverrideTable: [
            {
              styleID: 1,
              styleIdForFill: { guid: guid(10, 50) },
              fillPaints: [{ type: 'PATTERN', sourceNodeId: guid(10, 30) }]
            }
          ]
        },
        componentPropAssignments: [
          {
            defID: guid(10, 50),
            value: { guidValue: guid(10, 40) },
            varValue: { value: { symbolIdValue: { guid: guid(10, 30) } } }
          }
        ],
        componentPropRefs: [{ defID: guid(10, 50), componentPropNodeField: 'VISIBLE' }],
        componentPropDefs: [
          {
            id: guid(10, 50),
            name: 'Icon',
            initialValue: { guidValue: guid(10, 40) },
            parentPropDefId: guid(10, 55),
            varValue: { value: { alias: { guid: guid(10, 60) } } }
          }
        ],
        variantPropSpecs: [{ propDefId: guid(10, 50), value: 'Primary' }],
        derivedSymbolData: [{ guidPath: { guids: [guid(10, 30)] }, size: { x: 44, y: 44 } }],
        variableSetModes: [
          {
            id: guid(10, 70),
            name: 'Mode',
            parentVariableSetId: { guid: guid(10, 60) },
            parentModeId: guid(10, 70)
          }
        ],
        variableModeBySetMap: {
          entries: [
            {
              variableSetID: { guid: guid(10, 60) },
              variableModeID: guid(10, 70),
              variableSetExtensionID: { guid: guid(10, 60) }
            }
          ]
        },
        variableDataValues: {
          entries: [
            {
              modeID: guid(10, 70),
              variableData: {
                value: { alias: { guid: guid(10, 60) } },
                dataType: 'ALIAS',
                resolvedDataType: 'FLOAT'
              }
            }
          ]
        },
        parameterConsumptionMap: {
          entries: [{ variableData: { value: { alias: { guid: guid(10, 60) } } } }]
        },
        variableData: {
          value: { symbolIdValue: { guid: guid(10, 40) } },
          dataType: 'INSTANCE_SWAP',
          resolvedDataType: 'INSTANCE_SWAP'
        },
        handoffStatusMap: {
          entries: [{ guid: guid(10, 30), handoffStatus: { state: 'READY_FOR_DEV' } }]
        },
        prototypeStartNodeID: guid(10, 30),
        prototypeInteractions: [
          {
            id: guid(10, 40),
            actions: [
              {
                transitionNodeID: guid(10, 30),
                linkParam: { value: { alias: { guid: guid(10, 60) } } },
                cmsTarget: { nodeId: guid(10, 30) },
                targetVariableID: guid(10, 60),
                targetVariableValue: { alias: { guid: guid(10, 60) } },
                targetVariable: { id: { guid: guid(10, 60) } },
                targetVariableData: { value: { alias: { guid: guid(10, 60) } } },
                conditions: [{ value: { alias: { guid: guid(10, 60) } } }],
                conditionalActions: [
                  {
                    condition: { value: { alias: { guid: guid(10, 60) } } },
                    actions: [{ transitionNodeID: guid(10, 40) }]
                  }
                ],
                targetVariableSetID: { guid: guid(10, 60) },
                targetVariableModeID: guid(10, 70),
                variableSetTargetExtensionId: { guid: guid(10, 60) },
                animationTargetId: guid(10, 30),
                animationTimelineDefId: guid(10, 40)
              }
            ]
          }
        ]
      } as NodeChange,
      new Map([
        ['10:30', '99:30'],
        ['10:40', '99:40'],
        ['10:50', '99:50'],
        ['10:55', '99:55'],
        ['10:60', '99:60'],
        ['10:70', '99:70']
      ])
    )

    const deepRemapped = remapped as DeepRemappedNodeChange
    expectDeepSymbolOverrideReferences(deepRemapped.symbolData.symbolOverrides[0])
    expectDeepStyleAndPaintReferences(deepRemapped)
    expectDeepComponentReferences(deepRemapped)
    expectDeepVariableReferences(deepRemapped)
    expectDeepPrototypeReferences(deepRemapped)
  })
})
