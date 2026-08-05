import { spawn } from 'node:child_process'

import type { Plugin } from 'vite'

import { AUTOMATION_HTTP_PORT } from '@open-pencil/core/constants'
import { getSocketPath, platformHasUnixSockets } from '@open-pencil/mcp/transport'

// TODO: production — bundle MCP server as Tauri sidecar or spawn via shell plugin
export function automationPlugin(authToken: string | null, corsOrigin: string): Plugin {
  let child: ReturnType<typeof spawn> | null = null
  let starting: Promise<void> | null = null

  async function stopChild(): Promise<void> {
    const pendingStart = starting
    if (pendingStart) {
      try {
        await pendingStart
      } catch (error) {
        // configureServer reports startup failures to Vite; teardown still has to settle.
        void error
      }
    }
    const runningChild = child
    child = null
    runningChild?.kill()
  }

  return {
    name: 'open-pencil-automation',
    async configureServer(server) {
      if (child || starting) return

      starting = (async () => {
        // Only resolve and forward the socket path on platforms that support
        // Unix domain sockets. On Windows the MCP server falls back to TCP,
        // and forwarding OPENPENCIL_MCP_SOCKET would cause it to attempt a
        // socket listen that cannot succeed.
        const socketPath = platformHasUnixSockets() ? await getSocketPath() : null

        const childEnv = { ...process.env }
        delete childEnv.OPENPENCIL_MCP_SOCKET
        delete childEnv.OPENPENCIL_MCP_AUTH_TOKEN

        const spawned = spawn('bun', ['run', 'packages/mcp/src/index.ts'], {
          stdio: ['ignore', 'inherit', 'pipe'],
          env: {
            ...childEnv,
            PORT: String(AUTOMATION_HTTP_PORT),
            OPENPENCIL_MCP_TCP: '1',
            ...(socketPath ? { OPENPENCIL_MCP_SOCKET: socketPath } : {}),
            ...(authToken ? { OPENPENCIL_MCP_AUTH_TOKEN: authToken } : {}),
            OPENPENCIL_MCP_CORS_ORIGIN: corsOrigin,
            OPENPENCIL_MCP_ROOT: process.cwd()
          }
        })
        child = spawned

        spawned.on('error', (err) => {
          console.error(`[MCP] Failed to spawn automation server: ${err.message}`)
          if (child === spawned) child = null
        })

        spawned.stderr.on('data', (data: Buffer) => {
          const text = data.toString()
          if (text.includes('EADDRINUSE')) {
            console.error(
              `\x1b[31m[MCP] MCP bind failed (port ${AUTOMATION_HTTP_PORT}${socketPath ? ` or socket ${socketPath}` : ''}). Is another OpenPencil instance running?\x1b[0m`
            )
            spawned.kill()
            if (child === spawned) child = null
            return
          }
          process.stderr.write(data)
        })

        spawned.on('exit', (code) => {
          if (code && code !== 0) {
            console.error(`[MCP] Server exited with code ${code}`)
          }
          if (child === spawned) child = null
        })
      })()
      // Direct hook on the underlying HTTP server: shutdown paths that bypass
      // the Vite plugin lifecycle (e.g. process exit after the dev server is
      // force-closed) still tear down the spawned MCP child.
      server.httpServer?.once('close', () => {
        void stopChild()
      })

      try {
        await starting
      } finally {
        starting = null
      }
    },
    async buildEnd() {
      if (starting) {
        try {
          await starting
        } catch {
          void 0
        }
      }
      child?.kill()
      child = null
      starting = null
    }
  }
}
