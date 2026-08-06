import { afterEach, describe, expect, test } from 'bun:test'

import {
  createTauriFetch,
  tauriFetch,
  withAbortSignal,
  type ProxyHttpRequest,
  type ProxyHttpResponse
} from '@/app/tauri/http'

import { clearTauriMocks, mockTauriIPC } from '#tests/helpers/tauri/mocks'

type InvokeArgs = { request: ProxyHttpRequest }

function proxyBodyText(request: ProxyHttpRequest): string {
  return new TextDecoder().decode(new Uint8Array(request.body ?? []))
}

function proxyHeaderValue(request: ProxyHttpRequest, name: string): string | null {
  return request.headers?.find((header) => header.name.toLowerCase() === name)?.value ?? null
}

async function withBrowserStrictNullBodyResponse<T>(callback: () => Promise<T>): Promise<T> {
  const originalResponse = globalThis.Response
  const StrictResponse = class extends originalResponse {
    constructor(body?: BodyInit | null, init?: ResponseInit) {
      const status = init?.status
      if ((status === 204 || status === 205 || status === 304) && body != null) {
        throw new TypeError('Response with null body status cannot have body')
      }
      super(body, init)
    }
  } as typeof Response

  globalThis.Response = StrictResponse
  try {
    return await callback()
  } finally {
    globalThis.Response = originalResponse
  }
}

afterEach(async () => {
  await clearTauriMocks()
})

describe('withAbortSignal', () => {
  test('resolves with the wrapped promise', async () => {
    const controller = new AbortController()

    await expect(withAbortSignal(Promise.resolve('ok'), controller.signal)).resolves.toBe('ok')
  })

  test('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    const reason = new Error('cancelled')
    controller.abort(reason)

    const pending = Promise.withResolvers<string>()
    const result = withAbortSignal(pending.promise, controller.signal)

    await expect(result).rejects.toBe(reason)
    pending.reject(new Error('late request failure'))
    await Promise.resolve()
  })

  test('rejects a pending promise when the signal aborts', async () => {
    const controller = new AbortController()
    const pending = Promise.withResolvers<string>()
    const result = withAbortSignal(pending.promise, controller.signal)
    const reason = new Error('cancelled')

    controller.abort(reason)

    await expect(result).rejects.toBe(reason)
    pending.resolve('late result')
  })

  test('normalizes non-Error rejections from the wrapped promise', async () => {
    const controller = new AbortController()
    // oxlint-disable-next-line eslint(prefer-promise-reject-errors) -- Non-Error input is the contract under test.
    const rejected = Promise.reject('desktop failure')

    await expect(withAbortSignal(rejected, controller.signal)).rejects.toThrow(
      'Desktop HTTP request failed'
    )
  })
})

describe('tauriFetch', () => {
  test('passes request timeout metadata to the desktop HTTP command', async () => {
    let captured: InvokeArgs | null = null
    await mockTauriIPC((command, args) => {
      expect(command).toBe('proxy_http_request')
      captured = args as InvokeArgs
      return {
        status: 201,
        headers: [{ name: 'x-open-pencil', value: 'ok' }],
        body: [...new TextEncoder().encode('OK')]
      }
    })

    const response = await createTauriFetch({ timeoutMs: 15_000 })('https://example.test/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"ok":true}'
    })

    if (!captured) throw new Error('Expected proxy_http_request to be invoked')
    expect(response.status).toBe(201)
    expect(response.headers.get('x-open-pencil')).toBe('ok')
    expect(await response.text()).toBe('OK')
    expect(captured.request.url).toBe('https://example.test/check')
    expect(captured.request.method).toBe('POST')
    expect(captured.request.timeout_ms).toBe(15_000)
    expect(captured.request.body).toEqual(Array.from(new TextEncoder().encode('{"ok":true}')))
  })

  test('forwards bodies from Request inputs', async () => {
    let captured: InvokeArgs | null = null
    await mockTauriIPC((command, args) => {
      expect(command).toBe('proxy_http_request')
      captured = args as InvokeArgs
      return { status: 204, headers: [], body: [] }
    })

    const request = new Request('https://example.test/from-request', {
      method: 'POST',
      body: 'from-request'
    })
    const response = await tauriFetch(request)

    if (!captured) throw new Error('Expected proxy_http_request to be invoked')
    expect(response.status).toBe(204)
    expect(captured.request.method).toBe('POST')
    expect(proxyBodyText(captured.request)).toBe('from-request')
  })

  for (const status of [204, 205, 304]) {
    test(`constructs a null body for status ${status}`, async () => {
      await mockTauriIPC((command) => {
        expect(command).toBe('proxy_http_request')
        return { status, headers: [{ name: 'x-no-content', value: '1' }], body: [] }
      })

      await withBrowserStrictNullBodyResponse(async () => {
        const response = await tauriFetch(`https://example.test/status/${status}`)

        expect(response.status).toBe(status)
        expect(response.headers.get('x-no-content')).toBe('1')
        expect(await response.text()).toBe('')
      })
    })
  }

  test('forwards FormData bytes with the Request-generated content boundary', async () => {
    let captured: InvokeArgs | null = null
    await mockTauriIPC((command, args) => {
      expect(command).toBe('proxy_http_request')
      captured = args as InvokeArgs
      return { status: 204, headers: [], body: [] }
    })

    const formData = new FormData()
    formData.append('family', 'Inter')
    await tauriFetch('https://example.test/upload', { method: 'POST', body: formData })

    if (!captured) throw new Error('Expected proxy_http_request to be invoked')
    const contentType = proxyHeaderValue(captured.request, 'content-type')
    const boundary = contentType?.match(/boundary=(.+)$/)?.[1]
    if (!boundary) throw new Error(`Expected multipart boundary in content-type: ${contentType}`)

    const body = proxyBodyText(captured.request)
    expect(body).toContain(`--${boundary}`)
    expect(body).toContain('name="family"')
    expect(body).toContain('Inter')
  })

  test('rejects already-aborted requests before invoking the desktop command', async () => {
    let calls = 0
    await mockTauriIPC(() => {
      calls += 1
      return { status: 204, headers: [], body: [] }
    })
    const controller = new AbortController()
    controller.abort()

    await expect(
      tauriFetch('https://example.test/slow', { signal: controller.signal })
    ).rejects.toHaveProperty('name', 'AbortError')
    expect(calls).toBe(0)
  })

  test('rejects when an in-flight desktop command is aborted', async () => {
    let calls = 0
    let markStarted: (() => void) | null = null
    let rejectPendingResponse: ((reason: unknown) => void) | null = null
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    await mockTauriIPC(() => {
      calls += 1
      const resolve = markStarted
      if (!resolve) throw new Error('Expected start resolver to be installed')
      resolve()
      return new Promise<ProxyHttpResponse>((_, reject) => {
        rejectPendingResponse = reject
      })
    })
    const controller = new AbortController()

    const request = tauriFetch('https://example.test/slow', { signal: controller.signal })
    await started
    controller.abort()

    await expect(request).rejects.toHaveProperty('name', 'AbortError')
    expect(calls).toBe(1)
    const reject = rejectPendingResponse
    if (!reject) throw new Error('Expected pending response rejector')
    reject(new Error('late request failure'))
    await Promise.resolve()
  })
})
