import { computed, onMounted, ref } from 'vue'

import { appPreferences, updateSharingPreferences } from '@/app/settings/preferences/store'

import { FEEDBACK_ENABLED } from './config'
import { setUsageStatsConsent } from './consent'
import { sharingDisabledByEnvironment } from './state'

/** The Sharing section's switches, and why nothing is sent when nothing can be. */
export function useSharingSettings() {
  const disabledByEnvironment = ref(false)
  onMounted(async () => {
    disabledByEnvironment.value = await sharingDisabledByEnvironment()
  })

  return {
    dailyPing: computed({
      get: () => appPreferences.value.sharing.dailyPing,
      set: (dailyPing: boolean) => updateSharingPreferences({ dailyPing })
    }),
    usageStats: computed({
      get: () => appPreferences.value.sharing.usageStats === 'granted',
      set: (granted: boolean) => setUsageStatsConsent(granted, 'settings')
    }),
    unofficialBuild: !FEEDBACK_ENABLED,
    disabledByEnvironment
  }
}
