import { createServer as createHttpServer, IncomingMessage, type Server, ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import type { Logger } from './types';
import type { Storage } from './storage';

const SSL_CERT_DAYS = 365;
const SSL_CERT_VERSION = 2;
const SSL_CERT_STORAGE_KEY = 'homebridge-blinds-webhook-ssl-cert';

export interface WebhookOptions {
    port: number;
    https: boolean;
    httpsKeyFile: string | false;
    httpsCertFile: string | false;
    authUser: string | false;
    authPass: string | false;
    storage: Storage;
    log: Logger;
    /** Called when a valid `?pos=N` request arrives. Updates current + target. */
    onPosition: (pos: number) => void;
    /**
     * Called when a `?target=N` request arrives without a `pos`. Updates
     * only the HomeKit target so external automations (a physical remote,
     * a different smart-home hub, etc.) can inform HomeKit about a new
     * desired state without the plugin issuing its own move command.
     */
    onTarget?: (target: number) => void;
}

/**
 * Lightweight HTTP(S) server that lets external systems push the current
 * blind position into the plugin. The protocol is intentionally minimal
 * (`?pos=0..100`) and matches the pre-existing v2 behavior.
 *
 * When `https` is enabled but no key/cert files are provided, a self-signed
 * certificate is generated, cached on disk via the in-tree `Storage`, and
 * rotated when it approaches its expiration. The cache survives plugin
 * restarts.
 */
export function startWebhookServer(opts: WebhookOptions): Server {
    const handler = (req: IncomingMessage, res: ServerResponse): void => {
        if (!authorize(req, res, opts)) return;
        handleRequest(req, res, opts);
    };

    if (opts.https) {
        const sslOptions = resolveSslOptions(opts);
        const server = createHttpsServer(sslOptions, handler) as unknown as Server;
        server.listen(opts.port, '0.0.0.0');
        opts.log.info(`Started HTTPS server for webhook on port ${opts.port}`);
        return server;
    }

    const server = createHttpServer(handler);
    server.listen(opts.port, '0.0.0.0');
    opts.log.info(`Started HTTP server for webhook on port ${opts.port}`);
    return server;
}

/**
 * Validate Basic Auth when configured. Returns `true` if the request may
 * proceed, otherwise writes a 401 and returns `false`. Comparison uses
 * `timingSafeEqual` to avoid timing attacks against the credentials.
 */
function authorize(req: IncomingMessage, res: ServerResponse, opts: WebhookOptions): boolean {
    if (!opts.authUser || !opts.authPass) return true;

    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Basic ')) {
        res.statusCode = 401;
        res.setHeader('WWW-Authenticate', 'Basic realm="Authorization required"');
        res.end();
        return false;
    }

    let user = '';
    let pass = '';
    try {
        const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
        const idx = decoded.indexOf(':');
        if (idx >= 0) {
            user = decoded.slice(0, idx);
            pass = decoded.slice(idx + 1);
        }
    } catch {
        // Malformed header → fall through to credential check, which will
        // fail safely below.
    }

    const expectedUser = Buffer.from(opts.authUser);
    const expectedPass = Buffer.from(opts.authPass);
    const actualUser = Buffer.from(user.padEnd(expectedUser.length, '\0').slice(0, expectedUser.length));
    const actualPass = Buffer.from(pass.padEnd(expectedPass.length, '\0').slice(0, expectedPass.length));
    const ok =
        actualUser.length === expectedUser.length &&
        actualPass.length === expectedPass.length &&
        timingSafeEqual(actualUser, expectedUser) &&
        timingSafeEqual(actualPass, expectedPass) &&
        user.length === opts.authUser.length &&
        pass.length === opts.authPass.length;

    if (!ok) {
        res.statusCode = 401;
        res.setHeader('WWW-Authenticate', 'Basic realm="Authorization required"');
        res.end();
        return false;
    }
    return true;
}

function handleRequest(req: IncomingMessage, res: ServerResponse, opts: WebhookOptions): void {
    res.setHeader('Content-Type', 'application/json');

    let url: URL;
    try {
        url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false }));
        return;
    }

    const posParam = url.searchParams.get('pos');
    const targetParam = url.searchParams.get('target');
    const pos = parseIntegerInRange(posParam, 0, 100);
    const target = parseIntegerInRange(targetParam, 0, 100);

    // The request must specify at least one of `pos` (current position) or
    // `target` (desired position). Reject anything else with a 404 to keep
    // typo'd integrations loud rather than silently no-op'ing.
    if (pos === null && target === null) {
        opts.log.error(`Invalid webhook: expected ?pos=0..100 and/or ?target=0..100 (got: ${url.search || '(empty)'})`);
        res.statusCode = 404;
        res.end(JSON.stringify({ success: false }));
        return;
    }

    // Drain any request body to avoid stalling the connection.
    req.on('error', (err) => opts.log.error(`Error: ${err.message}`));
    req.on('data', () => {});
    req.on('end', () => {
        try {
            if (pos !== null) {
                opts.onPosition(pos);
            } else if (target !== null && opts.onTarget) {
                opts.onTarget(target);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            opts.log.error(`Webhook handler error: ${message}`);
        }
        res.statusCode = 200;
        res.end(JSON.stringify({ success: true }));
    });
}

function parseIntegerInRange(value: string | null, min: number, max: number): number | null {
    if (value == null) return null;
    const n = parseInt(value, 10);
    if (Number.isNaN(n) || n < min || n > max) return null;
    return n;
}

interface CachedSslCert {
    private: string;
    cert: string;
    timestamp: number;
    certVersion: number;
}

function resolveSslOptions(opts: WebhookOptions): { key: string | Buffer; cert: string | Buffer } {
    if (opts.httpsKeyFile && opts.httpsCertFile) {
        opts.log.info(`Using SSL certificate from ${opts.httpsKeyFile}`);
        return {
            key: readFileSync(opts.httpsKeyFile),
            cert: readFileSync(opts.httpsCertFile),
        };
    }

    opts.log.info('Using automatically generated self-signed SSL certificate');
    let cached = opts.storage.getItemSync<CachedSslCert>(SSL_CERT_STORAGE_KEY);
    if (cached) {
        const ageMs = Date.now() - cached.timestamp;
        const ageDays = ageMs / 1000 / 60 / 60 / 24;
        if (ageDays > SSL_CERT_DAYS - 1 || cached.certVersion !== SSL_CERT_VERSION) {
            cached = undefined;
        }
    }
    if (!cached) {
        opts.log.info('Generating new SSL self-signed certificate');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const selfsigned = require('selfsigned') as {
            generate: (
                attrs: Array<{ name: string; value: string }>,
                opts: { days: number },
            ) => { private: string; cert: string };
        };
        const pems = selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { days: SSL_CERT_DAYS });
        cached = {
            private: pems.private,
            cert: pems.cert,
            timestamp: Date.now(),
            certVersion: SSL_CERT_VERSION,
        };
        opts.storage.setItemSync(SSL_CERT_STORAGE_KEY, cached);
    }

    return { key: cached.private, cert: cached.cert };
}
