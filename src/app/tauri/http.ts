interface ProxyHttpHeader {
  name: string
  value: string
}

interface ProxyHttpRequest {
  url: string
  method?: string
  headers?: ProxyHttpHeader[]
  body?: number[]
}

interface ProxyHttpResponse {
  status: number
  headers: ProxyHttpHeader[]
  body: number[]
}

interface ProxyHttpStreamStart {
  status: number
  headers: ProxyHttpHeader[]
  event_name: string
}

interface ProxyHttpChunk {
  index: number
  done: boolean
  data: number[]
  error: string | null
}

function headersToProxyHeaders(headers: Headers): ProxyHttpHeader[] {
  return [...headers.entries()].map(([name, value]) => ({ name, value }))
}

async function bodyToBytes(body: BodyInit | null | undefined): Promise<number[] | undefined> {
  if (body == null) return undefined
  if (typeof body === 'string') return [...new TextEncoder().encode(body)]
  if (body instanceof ArrayBuffer) return [...new Uint8Array(body)]
  if (ArrayBuffer.isView(body))
    return [...new Uint8Array(body.buffer, body.byteOffset, body.byteLength)]
  if (body instanceof Blob) return [...new Uint8Array(await body.arrayBuffer())]
  if (body instanceof URLSearchParams) return [...new TextEncoder().encode(body.toString())]
  if (body instanceof FormData) {
    return [...new Uint8Array(await new Response(body).arrayBuffer())]
  }
  throw new TypeError('Streaming request bodies are not supported by the desktop HTTP bridge yet')
}

export async function tauriFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init)
  const { invoke } = await import('@tauri-apps/api/core')

  const payload: ProxyHttpRequest = {
    url: request.url,
    method: request.method,
    headers: headersToProxyHeaders(request.headers),
    body: await bodyToBytes(init?.body)
  }

  try {
    // Try the streaming endpoint first — preserves token-by-token SSE streaming
    // for AI chat and other streaming use cases.
    const streamStart = await invoke<ProxyHttpStreamStart>('proxy_http_request_stream', {
      request: payload
    })

    const { listen } = await import('@tauri-apps/api/event')
    const eventName = streamStart.event_name

    const bodyStream = new ReadableStream<Uint8Array>({
      start(controller) {
        let cleanup: (() => void) | null = null

        listen<ProxyHttpChunk>(eventName, (event) => {
          const chunk = event.payload
          if (chunk.error) {
            controller.error(new Error(chunk.error))
            cleanup?.()
            return
          }
          if (chunk.data.length > 0) {
            controller.enqueue(new Uint8Array(chunk.data))
          }
          if (chunk.done) {
            controller.close()
            cleanup?.()
          }
        })
          // eslint-disable-next-line promise/always-return -- side-effect only
          .then((unlisten) => {
            cleanup = unlisten
          })
          .catch(() => {
            controller.error(new Error('Event listener registration failed'))
          })
      },
      cancel() {
        // The Rust task will naturally stop when the stream ends or errors.
        // No explicit cancellation RPC is needed — the event listener is
        // removed when the ReadableStream is cancelled.
      }
    })

    return new Response(bodyStream, {
      status: streamStart.status,
      headers: streamStart.headers.map(({ name, value }): [string, string] => [name, value])
    })
  } catch {
    // Fall back to the buffered endpoint if streaming is unavailable
    // (e.g., older Tauri binary without the streaming command).
    const response = await invoke<ProxyHttpResponse>('proxy_http_request', { request: payload })
    return new Response(new Uint8Array(response.body), {
      status: response.status,
      headers: response.headers.map(({ name, value }): [string, string] => [name, value])
    })
  }
}
