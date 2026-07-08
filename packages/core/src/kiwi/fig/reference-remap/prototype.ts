import type {
  GUID,
  NodeChange,
  VariableAnyValue,
  VariableDataEntry
} from '@open-pencil/kiwi/fig/codec'

import {
  remapComponentPropValue,
  remapGuid,
  remapVariableDataEntry,
  type NodeChangeUpdates
} from './shared'

interface PrototypeFields {
  prototypeInteractions?: PrototypeInteraction[]
}

interface PrototypeInteraction {
  id?: GUID
  actions?: PrototypeAction[]
}

interface PrototypeVariableTarget {
  id?: { guid?: GUID }
}

interface CmsItemPageTarget {
  nodeId?: GUID
}

interface ConditionalActionGroup {
  actions?: PrototypeAction[]
  condition?: VariableDataEntry
}

interface PrototypeAction {
  transitionNodeID?: GUID
  linkParam?: VariableDataEntry
  cmsTarget?: CmsItemPageTarget
  targetVariableID?: GUID
  targetVariableValue?: VariableAnyValue
  targetVariable?: PrototypeVariableTarget
  targetVariableData?: VariableDataEntry
  conditions?: VariableDataEntry[]
  conditionalActions?: ConditionalActionGroup[]
  targetVariableSetID?: { guid?: GUID }
  targetVariableModeID?: GUID
  variableSetTargetExtensionId?: { guid?: GUID }
  animationTargetId?: GUID
  animationTimelineDefId?: GUID
}

function remapVariableDataEntries(
  entries: VariableDataEntry[] | undefined,
  guidRemap: Map<string, string>
): VariableDataEntry[] | undefined {
  if (!entries?.length) return undefined
  const result = entries.map((entry) => remapVariableDataEntry(entry, guidRemap) ?? entry)
  for (let i = 0; i < entries.length; i++) {
    if (result[i] !== entries[i]) return result
  }
  return undefined
}

function remapPrototypeActions(
  actions: PrototypeAction[] | undefined,
  guidRemap: Map<string, string>
): PrototypeAction[] | undefined {
  if (!actions?.length) return undefined
  const result = actions.map((action) => remapPrototypeAction(action, guidRemap))
  for (let i = 0; i < actions.length; i++) {
    if (result[i] !== actions[i]) return result
  }
  return undefined
}

function remapConditionalActionGroups(
  groups: ConditionalActionGroup[] | undefined,
  guidRemap: Map<string, string>
): ConditionalActionGroup[] | undefined {
  if (!groups?.length) return undefined
  const result = groups.map((group) => {
    const actions = remapPrototypeActions(group.actions, guidRemap)
    const condition = remapVariableDataEntry(group.condition, guidRemap)
    if (!actions && !condition) return group
    return { ...group, ...(actions ? { actions } : {}), ...(condition ? { condition } : {}) }
  })
  for (let i = 0; i < groups.length; i++) {
    if (result[i] !== groups[i]) return result
  }
  return undefined
}

function remapNavigationActionReferences(
  action: PrototypeAction,
  guidRemap: Map<string, string>,
  updates: Partial<PrototypeAction>
): void {
  const transitionNodeID = remapGuid(action.transitionNodeID, guidRemap)
  if (transitionNodeID) updates.transitionNodeID = transitionNodeID

  const linkParam = remapVariableDataEntry(action.linkParam, guidRemap)
  if (linkParam) updates.linkParam = linkParam

  const cmsNodeId = remapGuid(action.cmsTarget?.nodeId, guidRemap)
  if (cmsNodeId && action.cmsTarget) updates.cmsTarget = { ...action.cmsTarget, nodeId: cmsNodeId }
}

function remapTargetVariableActionReferences(
  action: PrototypeAction,
  guidRemap: Map<string, string>,
  updates: Partial<PrototypeAction>
): void {
  const targetVariableID = remapGuid(action.targetVariableID, guidRemap)
  if (targetVariableID) updates.targetVariableID = targetVariableID

  const targetVariableValue = remapComponentPropValue(action.targetVariableValue, guidRemap)
  if (targetVariableValue) updates.targetVariableValue = targetVariableValue

  const targetVariableId = remapGuid(action.targetVariable?.id?.guid, guidRemap)
  if (targetVariableId && action.targetVariable) {
    updates.targetVariable = {
      ...action.targetVariable,
      id: { ...action.targetVariable.id, guid: targetVariableId }
    }
  }

  const targetVariableData = remapVariableDataEntry(action.targetVariableData, guidRemap)
  if (targetVariableData) updates.targetVariableData = targetVariableData

  const conditions = remapVariableDataEntries(action.conditions, guidRemap)
  if (conditions) updates.conditions = conditions

  const conditionalActions = remapConditionalActionGroups(action.conditionalActions, guidRemap)
  if (conditionalActions) updates.conditionalActions = conditionalActions
}

function remapVariableModeActionReferences(
  action: PrototypeAction,
  guidRemap: Map<string, string>,
  updates: Partial<PrototypeAction>
): void {
  const targetVariableSetID = remapGuid(action.targetVariableSetID?.guid, guidRemap)
  if (targetVariableSetID && action.targetVariableSetID) {
    updates.targetVariableSetID = { ...action.targetVariableSetID, guid: targetVariableSetID }
  }

  const targetVariableModeID = remapGuid(action.targetVariableModeID, guidRemap)
  if (targetVariableModeID) updates.targetVariableModeID = targetVariableModeID

  const variableSetTargetExtensionId = remapGuid(
    action.variableSetTargetExtensionId?.guid,
    guidRemap
  )
  if (variableSetTargetExtensionId && action.variableSetTargetExtensionId) {
    updates.variableSetTargetExtensionId = {
      ...action.variableSetTargetExtensionId,
      guid: variableSetTargetExtensionId
    }
  }
}

function remapAnimationActionReferences(
  action: PrototypeAction,
  guidRemap: Map<string, string>,
  updates: Partial<PrototypeAction>
): void {
  const animationTargetId = remapGuid(action.animationTargetId, guidRemap)
  if (animationTargetId) updates.animationTargetId = animationTargetId

  const animationTimelineDefId = remapGuid(action.animationTimelineDefId, guidRemap)
  if (animationTimelineDefId) updates.animationTimelineDefId = animationTimelineDefId
}

function remapPrototypeAction(
  action: PrototypeAction,
  guidRemap: Map<string, string>
): PrototypeAction {
  const updates: Partial<PrototypeAction> = {}
  remapNavigationActionReferences(action, guidRemap, updates)
  remapTargetVariableActionReferences(action, guidRemap, updates)
  remapVariableModeActionReferences(action, guidRemap, updates)
  remapAnimationActionReferences(action, guidRemap, updates)

  return Object.keys(updates).length === 0 ? action : { ...action, ...updates }
}

function remapPrototypeInteractions(
  interactions: PrototypeInteraction[] | undefined,
  guidRemap: Map<string, string>
): PrototypeInteraction[] | undefined {
  if (!interactions?.length) return undefined
  const result = interactions.map((interaction) => {
    const id = remapGuid(interaction.id, guidRemap)
    const actions = remapPrototypeActions(interaction.actions, guidRemap)
    if (!id && !actions) return interaction
    return { ...interaction, ...(id ? { id } : {}), ...(actions ? { actions } : {}) }
  })
  for (let i = 0; i < interactions.length; i++) {
    if (result[i] !== interactions[i]) return result
  }
  return undefined
}

export function remapPrototypeReferences(
  nc: NodeChange,
  guidRemap: Map<string, string>,
  updates: NodeChangeUpdates
): void {
  const prototypeStartNodeID = remapGuid(nc.prototypeStartNodeID, guidRemap)
  if (prototypeStartNodeID) updates.prototypeStartNodeID = prototypeStartNodeID

  const prototypeInteractions = remapPrototypeInteractions(
    (nc as PrototypeFields).prototypeInteractions,
    guidRemap
  )
  if (prototypeInteractions) updates.prototypeInteractions = prototypeInteractions
}
