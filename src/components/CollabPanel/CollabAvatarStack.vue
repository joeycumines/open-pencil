<script setup lang="ts">
import { colorToCSS } from '@open-pencil/core/color'

import Tip from '@/components/ui/Tip.vue'
import { initials } from '@/app/shell/ui'
import { useCollabPanelContext } from '@/components/CollabPanel/context'
import { useI18n } from '@open-pencil/vue'

const collab = useCollabPanelContext()
const { dialogs } = useI18n()

function peerTooltip(peer: (typeof collab.peers)[number]) {
  if (peer.selectionStatus === 'unsupported') {
    return `${peer.name}: selection sharing unavailable (incompatible collaboration protocol)`
  }
  if (peer.selectionStatus === 'malformed') {
    return `${peer.name}: selection sharing hidden (malformed collaboration payload)`
  }
  return collab.followingPeer === peer.clientId
    ? dialogs.value.followingPeerStop({ name: peer.name })
    : dialogs.value.clickToFollowPeer({ name: peer.name })
}
</script>

<template>
  <div class="flex -space-x-1.5">
    <Tip :label="`${collab.state.localName || dialogs.you} (${dialogs.youSuffix})`">
      <div
        data-test-id="collab-local-avatar"
        class="flex size-6 items-center justify-center rounded-full border-2 border-panel text-[10px] font-semibold text-white"
        :style="{ background: colorToCSS(collab.state.localColor) }"
      >
        {{ initials(collab.state.localName || dialogs.you) }}
      </div>
    </Tip>

    <Tip v-for="peer in collab.peers" :key="peer.clientId" :label="peerTooltip(peer)">
      <div
        data-test-id="collab-peer-avatar"
        class="flex size-6 cursor-pointer items-center justify-center rounded-full border-2 text-[10px] font-semibold text-white transition-all"
        :class="
          collab.followingPeer === peer.clientId
            ? 'border-white ring-2 ring-white/40'
            : 'border-panel'
        "
        :style="{ background: colorToCSS(peer.color) }"
        @click="collab.toggleFollowPeer(peer.clientId)"
      >
        {{ initials(peer.name) }}
      </div>
    </Tip>
  </div>
</template>
