<script setup lang="ts">
import { computed } from 'vue'

import type { Color } from '@open-pencil/scene-graph'
import { colorToCSS } from '@open-pencil/scene-graph/color'

/** A status's color, as the canvas label, panels and menus mark it. */
const { color } = defineProps<{ color: Color | undefined }>()

const background = computed(() => (color ? colorToCSS(color) : undefined))
</script>

<template>
  <span
    aria-hidden="true"
    data-slot="status-dot"
    class="inline-block size-2 shrink-0 rounded-full bg-muted"
    :style="background ? { backgroundColor: background } : undefined"
  />
</template>
