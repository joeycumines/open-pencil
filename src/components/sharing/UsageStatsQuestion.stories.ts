import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, within } from 'storybook/test'

import {
  appPreferences,
  updateSharingPreferences,
  type UsageStatsConsent
} from '@/app/settings/preferences/store'
import { usageStatsPrompt } from '@/app/telemetry'

import UsageStatsPrompt from './UsageStatsPrompt.vue'
import UsageStatsQuestion from './UsageStatsQuestion.vue'

interface Args {
  consent: UsageStatsConsent
  source: 'welcome' | 'prompt'
}

const meta = {
  title: 'App/Settings/Sharing/Usage Stats Question',
  component: UsageStatsQuestion,
  args: { consent: 'unset', source: 'welcome' },
  render: (args) => ({
    components: { UsageStatsQuestion },
    setup() {
      updateSharingPreferences({ usageStats: args.consent })
      return { args }
    },
    template: '<div class="max-w-80"><UsageStatsQuestion :source="args.source" /></div>'
  })
} satisfies Meta<Args>

export default meta
type Story = StoryObj<typeof meta>

export const Asking: Story = {}

export const Accepted: Story = { args: { consent: 'granted' } }

export const Declined: Story = { args: { consent: 'denied' } }

/** Answering replaces the choices with the answer and where to change it. */
export const Answering: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Share stats' }))
    await expect(canvas.getByRole('status')).toHaveTextContent('Thank you.')
    await expect(appPreferences.value.sharing.usageStats).toBe('granted')
  }
}

/** The card shown once the first-run welcome closes, and on a later launch until answered. */
export const Prompt: Story = {
  render: () => ({
    components: { UsageStatsPrompt },
    setup() {
      updateSharingPreferences({ usageStats: 'unset' })
      usageStatsPrompt.value = 'welcome'
      return {}
    },
    template: '<UsageStatsPrompt />'
  })
}
