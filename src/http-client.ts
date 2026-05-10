import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { HttpEndpoint, Logger } from './types';

const execAsync = promisify(exec);

export interface HttpClientOptions {
    /** Request timeout in milliseconds (per attempt). */
    timeout: number;
    /** Maximum retry attempts on network or 5xx errors. */
    maxAttempts: number;
    /** Base delay between retries (ms); each retry waits 2x the previous. */
    retryDelay: number;
    /** HTTP status codes considered successful. */
    successCodes: number[];
}

export interface HttpResult {
    /** Response body as text. `null` when the request was a no-op. */
    body: string | null;
    /** Total time spent on the request including retries (ms). */
    requestTime: number;
    /** Number of attempts made; `1` means succeeded on the first try. */
    attempts: number;
    /** Final HTTP status, or `0` for non-HTTP (e.g. file://) results. */
    statusCode: number;
}

/**
 * HTTP client with per-attempt timeout, exponential-backoff retries on
 * network errors and 5xx responses, and a `file://` URL escape hatch that
 * runs the URL as a shell command.
 */
export class HttpClient {
    constructor(
        private readonly opts: HttpClientOptions,
        private readonly log: Logger,
        private readonly verbose: boolean,
    ) {}

    /**
     * Perform a request, with `defaults` merged into the endpoint as
     * fallbacks. A `false` endpoint resolves to a no-op; this lets callers
     * skip the "is it configured?" check at every call site.
     */
    async request(endpoint: HttpEndpoint | false, defaults: Partial<HttpEndpoint> = {}): Promise<HttpResult> {
        if (!endpoint) {
            return { body: null, requestTime: 0, attempts: 0, statusCode: 0 };
        }

        const merged: HttpEndpoint = { ...defaults, ...endpoint };
        const cmdMatch = merged.url.match(/^file:\/\/(.*)$/i);
        if (cmdMatch) {
            return this.execShell(cmdMatch[1]);
        }
        return this.fetchWithRetry(merged);
    }

    private async execShell(cmd: string): Promise<HttpResult> {
        const start = Date.now();
        try {
            const { stdout, stderr } = await execAsync(cmd);
            const requestTime = Date.now() - start;
            if (this.verbose) {
                this.log.info(`Command succeeded in ${requestTime} ms`);
                this.log.info(`Stdout: ${stdout}`);
                if (stderr) this.log.info(`Stderr: ${stderr}`);
            }
            return { body: stdout, requestTime, attempts: 1, statusCode: 0 };
        } catch (err) {
            const requestTime = Date.now() - start;
            const message = err instanceof Error ? err.message : String(err);
            this.log.error(`Error running command: ${message}`);
            throw new HttpRequestError(message, requestTime, 0, 0);
        }
    }

    private async fetchWithRetry(endpoint: HttpEndpoint): Promise<HttpResult> {
        const maxAttempts = Math.max(endpoint.maxAttempts ?? this.opts.maxAttempts, 1);
        const baseDelay = endpoint.retryDelay ?? this.opts.retryDelay;
        const timeout = endpoint.timeout ?? this.opts.timeout;
        const start = Date.now();

        let lastError: Error | undefined;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeout);
            try {
                const init: RequestInit = {
                    method: endpoint.method ?? 'GET',
                    headers: endpoint.headers,
                    signal: controller.signal,
                };
                if (endpoint.body !== undefined && init.method !== 'GET') {
                    init.body = typeof endpoint.body === 'string' ? endpoint.body : JSON.stringify(endpoint.body);
                }
                const response = await fetch(endpoint.url, init);
                const body = await response.text();

                if (this.opts.successCodes.includes(response.status)) {
                    const requestTime = Date.now() - start;
                    if (attempt > 1 || this.verbose) {
                        this.log.info(`Request succeeded in ${requestTime} ms after ${attempt} attempt(s)`);
                    }
                    if (this.verbose) {
                        this.log.info(`Body (${response.status}): ${body}`);
                    }
                    return { body, requestTime, attempts: attempt, statusCode: response.status };
                }

                lastError = new Error(`HTTP status ${response.status}: ${body}`);
                if (response.status < 500 || attempt === maxAttempts) {
                    // 4xx is not retried; the device rejected the request.
                    const requestTime = Date.now() - start;
                    this.log.error(`Error sending request (HTTP status code ${response.status})`);
                    this.log.error(`${attempt} attempt(s) failed after ${requestTime} ms`);
                    this.log.error(`Body: ${body}`);
                    throw new HttpRequestError(lastError.message, requestTime, attempt, response.status);
                }
            } catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err));
                if (err instanceof HttpRequestError) throw err;
                if (attempt === maxAttempts) {
                    const requestTime = Date.now() - start;
                    this.log.error(`Error sending request: ${lastError.message}`);
                    this.log.error(`${attempt} attempt(s) failed after ${requestTime} ms`);
                    throw new HttpRequestError(lastError.message, requestTime, attempt, 0);
                }
            } finally {
                clearTimeout(timer);
            }

            const delay = baseDelay * Math.pow(2, attempt - 1);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }

        // Unreachable; satisfies the type system.
        throw new HttpRequestError(lastError?.message ?? 'request failed', Date.now() - start, maxAttempts, 0);
    }
}

/** Thrown after retries are exhausted; carries timing/attempt metadata. */
export class HttpRequestError extends Error {
    constructor(
        message: string,
        public readonly requestTime: number,
        public readonly attempts: number,
        public readonly statusCode: number,
    ) {
        super(message);
        this.name = 'HttpRequestError';
    }
}
