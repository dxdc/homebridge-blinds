import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpClient, HttpRequestError } from '../src/http-client';
import { createTestLogger } from './test-utils';

const opts = {
    timeout: 1000,
    maxAttempts: 3,
    retryDelay: 1, // keep tests fast
    successCodes: [200, 204],
};

describe('HttpClient', () => {
    let originalFetch: typeof fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it('returns a no-op result when the endpoint is false', async () => {
        const client = new HttpClient(opts, createTestLogger(), false);
        const result = await client.request(false);
        expect(result.body).toBeNull();
        expect(result.attempts).toBe(0);
    });

    it('succeeds on the first try', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 })) as typeof fetch;
        const client = new HttpClient(opts, createTestLogger(), false);
        const result = await client.request({ url: 'http://x' });
        expect(result.body).toBe('ok');
        expect(result.attempts).toBe(1);
    });

    it('retries on 5xx and eventually succeeds', async () => {
        let calls = 0;
        globalThis.fetch = vi.fn().mockImplementation(async () => {
            calls++;
            if (calls < 3) return new Response('busy', { status: 503 });
            return new Response('ok', { status: 200 });
        }) as typeof fetch;
        const client = new HttpClient(opts, createTestLogger(), false);
        const result = await client.request({ url: 'http://x' });
        expect(result.attempts).toBe(3);
        expect(result.body).toBe('ok');
    });

    it('does not retry on 4xx', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('bad', { status: 401 }));
        globalThis.fetch = fetchMock as typeof fetch;
        const client = new HttpClient(opts, createTestLogger(), false);
        await expect(client.request({ url: 'http://x' })).rejects.toBeInstanceOf(HttpRequestError);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('propagates a final failure after exhausting retries', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(new Response('busy', { status: 503 })) as typeof fetch;
        const client = new HttpClient(opts, createTestLogger(), false);
        await expect(client.request({ url: 'http://x' })).rejects.toBeInstanceOf(HttpRequestError);
    });

    it('aborts on timeout', async () => {
        globalThis.fetch = vi.fn().mockImplementation(
            (_url, init) =>
                new Promise((_resolve, reject) => {
                    (init as RequestInit).signal?.addEventListener('abort', () => reject(new Error('aborted')));
                }),
        ) as typeof fetch;
        const client = new HttpClient({ ...opts, timeout: 20, maxAttempts: 1 }, createTestLogger(), false);
        await expect(client.request({ url: 'http://x' })).rejects.toBeInstanceOf(HttpRequestError);
    });

    it('honors per-endpoint maxAttempts override', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('busy', { status: 500 }));
        globalThis.fetch = fetchMock as typeof fetch;
        const client = new HttpClient(opts, createTestLogger(), false);
        await expect(client.request({ url: 'http://x', maxAttempts: 1 })).rejects.toBeInstanceOf(HttpRequestError);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('runs file:// URLs as shell commands', async () => {
        const client = new HttpClient(opts, createTestLogger(), false);
        const result = await client.request({ url: 'file://echo hello-world' });
        expect(result.body?.trim()).toBe('hello-world');
    });
});
