<script setup lang="ts">
import { closeSaveTo, confirmSaveTo, saveToSession } from '@/app/storage/save-to/session'

import SaveToDialog from './SaveToDialog.vue'

/** The Save to dialog, driven by the app's save flow for whichever tab opened it. */
</script>

<template>
  <SaveToDialog
    v-if="saveToSession"
    v-model:name="saveToSession.name"
    v-model:destination="saveToSession.chosen"
    :open="saveToSession.open"
    :destinations="saveToSession.destinations"
    :state="saveToSession.state"
    @update:open="(open) => !open && closeSaveTo()"
    @save="confirmSaveTo"
    @cancel="closeSaveTo"
  />
</template>
