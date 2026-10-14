/**
 * Whether this build may send anything. Only official release builds set the flag, so forks,
 * self-built apps, dev servers, and tests send no pings or usage stats.
 */
export const FEEDBACK_ENABLED =
  import.meta.env.PROD && import.meta.env.VITE_OPENPENCIL_FEEDBACK === 'on'
