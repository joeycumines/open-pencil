import type { Generated } from 'kysely'

export interface UsagePingTable {
  day: string
  version: string
  platform: string
  arch: string
  app: string
  browser: string
  usageStats: string
  count: number
}

export interface WaitlistTable {
  id: Generated<number>
  email: string
  emailKey: string
  note: string | null
  token: string
  createdAt: string
  confirmationSentAt: string
  confirmedAt: string | null
}

/** The D1 tables `migrations/` creates, in Kysely's camelCase. */
export interface FeedbackDatabase {
  usagePings: UsagePingTable
  waitlist: WaitlistTable
}
