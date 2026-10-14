<script setup lang="ts">
import { tv } from 'tailwind-variants'
import { computed } from 'vue'

import statusTheme, { type StatusTone } from '@/theme/feedback/status'

/** A state as a coloured dot and its label, announced politely when it changes. */
const { tone = 'neutral' } = defineProps<{ tone?: StatusTone }>()
const styles = computed(() => tv(statusTheme)({ tone }))
</script>

<template>
  <span :class="styles.indicator()" role="status" :data-tone="tone">
    <span :class="styles.dot()" aria-hidden="true" />
    <slot />
  </span>
</template>
