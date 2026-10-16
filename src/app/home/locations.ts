import { computed } from 'vue'

import { useHomeCloud } from '@/app/cloud/integration'
import { openSettingsDialog } from '@/app/settings/dialog'

import { homeLocation, type HomeLocation } from './location'

/** A Home location as the sidebar and the phone menu name it. */
export type HomeLocationView =
  | { kind: 'recent'; id: 'recent' }
  | { kind: 'workspace'; id: string }
  | { kind: 'shared'; id: 'shared' }
  | { kind: 'storage'; id: 'storage' }

const VIEWS = {
  recent: { kind: 'recent', id: 'recent' },
  shared: { kind: 'shared', id: 'shared' },
  storage: { kind: 'storage', id: 'storage' }
} as const satisfies Record<Exclude<HomeLocation['kind'], 'workspace'>, HomeLocationView>

function toView(location: HomeLocation): HomeLocationView {
  return location.kind === 'workspace' ? location : VIEWS[location.kind]
}

function fromView(location: HomeLocationView): HomeLocation {
  return location.kind === 'workspace' ? location : { kind: location.kind }
}

/**
 * Where Home can list documents from: Recent, the workspaces and shared documents of the server
 * Home shows when signed in to it, and storage. A Cloud location the account can no longer
 * reach falls back to Recent.
 */
export function useHomeLocations() {
  const cloud = useHomeCloud()
  const workspaces = cloud.workspaces

  const location = computed<HomeLocation>(() => {
    const chosen = homeLocation.value
    if (chosen.kind === 'shared' && !cloud.signedIn.value) return { kind: 'recent' }
    if (chosen.kind === 'workspace' && !workspaces.value.some((entry) => entry.id === chosen.id)) {
      return { kind: 'recent' }
    }
    return chosen
  })
  const workspace = computed(() => {
    const current = location.value
    return current.kind === 'workspace'
      ? (workspaces.value.find((entry) => entry.id === current.id) ?? null)
      : null
  })

  return {
    account: cloud.account,
    workspaces,
    location,
    workspace,
    serverId: cloud.serverId,
    active: computed(() => toView(location.value)),
    select(next: HomeLocationView) {
      homeLocation.value = fromView(next)
    },
    connect: cloud.connect,
    accountSettings: () => openSettingsDialog('cloud'),
    newWorkspace: cloud.newWorkspace,
    storageSettings: () => openSettingsDialog('storage'),
    signOut: cloud.signOut
  }
}
