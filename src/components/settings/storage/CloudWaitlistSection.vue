<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'

import { useStorageMessages } from '@open-pencil/vue'

import { useWaitlistSignup } from '@/app/cloud/waitlist/signup'
import { openExternalLink } from '@/app/shell/ui'
import SettingsSection from '@/components/settings/layout/SettingsSection.vue'
import ProviderSettingsField from '@/components/settings/provider/ProviderSettingsField.vue'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import { CLOUD_WAITLIST_URL, IS_TAURI } from '@/constants'

/**
 * OpenPencil Cloud, offered where people set up storage by hand. The web app signs up here; the
 * desktop app opens the website, since Turnstile runs only on the sites the service accepts.
 */
const storage = useStorageMessages()
const turnstile = useTemplateRef<HTMLElement>('turnstile')
const { email, status, submitting, confirming, edit, submit } = useWaitlistSignup(turnstile)

const failure = computed(() => {
  if (status.value === 'refused') return storage.value.waitlistRefused
  if (status.value === 'limited') return storage.value.waitlistLimited
  if (status.value === 'failed') return storage.value.waitlistFailed
  if (status.value === 'unavailable') return storage.value.waitlistUnavailable
  return null
})
</script>

<template>
  <SettingsSection data-test-id="settings-cloud-waitlist">
    <template #title>{{ storage.cloudTitle }}</template>
    <template #description>{{ storage.cloudDescription }}</template>
    <AppButton
      v-if="IS_TAURI"
      class="self-start"
      variant="outline"
      @click="openExternalLink(CLOUD_WAITLIST_URL)"
    >
      {{ storage.waitlistOpenWebsite }}
      <template #trailing><icon-lucide-external-link aria-hidden="true" /></template>
    </AppButton>
    <AppAlert
      v-else-if="status === 'joined'"
      tone="success"
      :heading="storage.waitlistJoined"
      :description="storage.waitlistJoinedDetail"
    />
    <template v-else>
      <!-- The Storage panel is a form of its own, so this is a group that submits on Enter. -->
      <div class="flex flex-col gap-2" role="group" :aria-label="storage.cloudTitle">
        <ProviderSettingsField
          v-slot="{ control }"
          :label="storage.waitlistEmail"
          :error="status === 'invalid' ? storage.waitlistInvalid : undefined"
        >
          <AppInput
            v-bind="control"
            v-model="email"
            type="email"
            autocomplete="email"
            tone="panel"
            :placeholder="storage.waitlistPlaceholder"
            :disabled="submitting"
            @update:model-value="edit"
            @keydown.enter.prevent="submit"
          />
        </ProviderSettingsField>
        <!-- Turnstile draws here only when it needs a click, above the button it holds up. -->
        <div ref="turnstile" />
        <AppButton
          class="self-start"
          color="primary"
          variant="solid"
          :loading="submitting && !confirming"
          :disabled="confirming"
          @click="submit"
        >
          {{ confirming ? storage.waitlistConfirmHuman : storage.waitlistJoin }}
        </AppButton>
      </div>
      <AppAlert v-if="failure" tone="error" :heading="failure">
        <template v-if="status === 'unavailable'" #actions>
          <AppButton variant="outline" size="xs" @click="openExternalLink(CLOUD_WAITLIST_URL)">
            {{ storage.waitlistOpenWebsite }}
          </AppButton>
        </template>
      </AppAlert>
    </template>
  </SettingsSection>
</template>
