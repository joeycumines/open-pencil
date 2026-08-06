import { randomUUID } from 'node:crypto'
import process from 'node:process'

import { AUTOMATION_HTTP_PORT } from '@open-pencil/core/constants'
import { getSocketPath, platformHasUnixSockets } from '@open-pencil/mcp/transport'

import { automationPlugin } from '../src/app/automation/bridge/vite-plugin'

const devAutomationAuthToken = process.env.OPENPENCIL_DEV_TOKEN ?? randomUUID()

export function localAutomationToken(command: string): string | null {
  return command === 'serve' ? devAutomationAuthToken : null
}

export function automationCorsOrigin(host: string | undefined): string {
  return host ? `http://${host}:1420` : 'http://localhost:1420'
}

export function openPencilAutomationPlugin(command: string, host: string | undefined) {
  return automationPlugin({
    authToken: localAutomationToken(command),
    corsOrigin: automationCorsOrigin(host),
    httpPort: AUTOMATION_HTTP_PORT,
    getSocketPath,
    platformHasUnixSockets
  })
}
