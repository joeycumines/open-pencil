<script setup lang="ts">
import { tv } from 'tailwind-variants'
import { useId } from 'vue'

import { usageStatsPrompt } from '@/app/telemetry'
import theme from '@/theme/sharing/prompt'

import UsageStatsQuestion from './UsageStatsQuestion.vue'

const styles = tv(theme)()
const headingId = useId()
</script>

<template>
  <aside
    v-if="usageStatsPrompt"
    :class="styles.root()"
    :aria-labelledby="headingId"
    data-test-id="usage-stats-prompt"
  >
    <UsageStatsQuestion :source="usageStatsPrompt" :heading-id="headingId" />
  </aside>
</template>
