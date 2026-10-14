import type { Meta, StoryObj } from '@storybook/vue3-vite'

import type { StatusTone } from '@/theme/feedback/status'

import AppStatus from './AppStatus.vue'

const tones: Record<StatusTone, string> = {
  neutral: 'Stopped',
  pending: 'Starting…',
  success: 'Running',
  warning: 'Unreachable',
  error: 'Error'
}

const meta = {
  title: 'Design System/Feedback/Status',
  component: AppStatus,
  render: () => ({
    components: { AppStatus },
    setup: () => ({ tones: Object.entries(tones) }),
    template: `
      <div class="flex flex-col gap-3 bg-panel p-4">
        <AppStatus v-for="[tone, label] in tones" :key="tone" :tone="tone">{{ label }}</AppStatus>
      </div>`
  })
} satisfies Meta<typeof AppStatus>

export default meta
type Story = StoryObj<typeof meta>

export const Tones: Story = {}
