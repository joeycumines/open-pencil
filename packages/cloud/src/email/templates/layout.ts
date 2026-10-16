import type { VNode } from 'vue'

import { emailLayout } from '@open-pencil/feedback/email'

export type TransactionalEmailLayout = {
  preview: string
  heading: string
  message: string
  actionLabel: string
  actionURL: string
  footer?: string
}

/** Cloud's mail in the same branded layout as the waitlist's, so people know who wrote. */
export function transactionalEmailLayout(props: TransactionalEmailLayout): VNode {
  const { footer, ...content } = props
  return emailLayout({ ...content, note: footer ? { text: footer } : undefined })
}
