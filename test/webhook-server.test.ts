import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { startWebhookServer } from '../src/webhook-server';
import { Storage } from '../src/storage';
import { createTestLogger } from './test-utils';

interface Fixture {
    server: Server;
    port: number;
    onPosition: ReturnType<typeof vi.fn>;
    onTarget: ReturnType<typeof vi.fn>;
    close: () => Promise<void>;
}

async function startWebhook(authUser: string | false = false, authPass: string | false = false): Promise<Fixture> {
    const dir = mkdtempSync(join(tmpdir(), 'hb-blinds-webhook-'));
    const onPosition = vi.fn();
    const onTarget = vi.fn();

    const server = startWebhookServer({
        port: 0, // ephemeral
        https: false,
        httpsKeyFile: false,
        httpsCertFile: false,
        authUser,
        authPass,
        storage: new Storage(dir),
        log: createTestLogger(),
        onPosition,
        onTarget,
    });

    // Wait for the server to bind to its ephemeral port.
    while (!server.listening) {
        await new Promise((r) => setTimeout(r, 5));
    }
    const port = (server.address() as AddressInfo).port;

    return {
        server,
        port,
        onPosition,
        onTarget,
        close: async () => {
            await new Promise<void>((resolve) => server.close(() => resolve()));
            rmSync(dir, { recursive: true, force: true });
        },
    };
}

async function get(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
    const res = await fetch(url, { headers });
    return { status: res.status, body: await res.text() };
}

describe('webhook server', () => {
    let fx: Fixture;

    beforeEach(async () => {
        fx = await startWebhook();
    });

    afterEach(async () => {
        await fx.close();
    });

    it('routes ?pos=N to onPosition', async () => {
        const res = await get(`http://127.0.0.1:${fx.port}/?pos=42`);
        expect(res.status).toBe(200);
        expect(fx.onPosition).toHaveBeenCalledWith(42);
        expect(fx.onTarget).not.toHaveBeenCalled();
    });

    it('routes ?target=N (without pos) to onTarget', async () => {
        const res = await get(`http://127.0.0.1:${fx.port}/?target=33`);
        expect(res.status).toBe(200);
        expect(fx.onTarget).toHaveBeenCalledWith(33);
        expect(fx.onPosition).not.toHaveBeenCalled();
    });

    it('prefers pos over target when both are provided', async () => {
        await get(`http://127.0.0.1:${fx.port}/?pos=10&target=90`);
        expect(fx.onPosition).toHaveBeenCalledWith(10);
        expect(fx.onTarget).not.toHaveBeenCalled();
    });

    it('rejects out-of-range or missing values with 404', async () => {
        const r1 = await get(`http://127.0.0.1:${fx.port}/?pos=200`);
        expect(r1.status).toBe(404);
        const r2 = await get(`http://127.0.0.1:${fx.port}/?foo=1`);
        expect(r2.status).toBe(404);
        expect(fx.onPosition).not.toHaveBeenCalled();
        expect(fx.onTarget).not.toHaveBeenCalled();
    });
});

describe('webhook server: basic auth', () => {
    let fx: Fixture;

    beforeEach(async () => {
        fx = await startWebhook('alice', 's3cret');
    });

    afterEach(async () => {
        await fx.close();
    });

    it('rejects requests without credentials', async () => {
        const res = await get(`http://127.0.0.1:${fx.port}/?pos=1`);
        expect(res.status).toBe(401);
    });

    it('accepts correct credentials', async () => {
        const auth = `Basic ${Buffer.from('alice:s3cret').toString('base64')}`;
        const res = await get(`http://127.0.0.1:${fx.port}/?pos=1`, { Authorization: auth });
        expect(res.status).toBe(200);
        expect(fx.onPosition).toHaveBeenCalledWith(1);
    });

    it('rejects wrong credentials', async () => {
        const auth = `Basic ${Buffer.from('alice:wrong').toString('base64')}`;
        const res = await get(`http://127.0.0.1:${fx.port}/?pos=1`, { Authorization: auth });
        expect(res.status).toBe(401);
    });

    it('rejects credentials of differing length to defeat truncation', async () => {
        const auth = `Basic ${Buffer.from('alice:s3').toString('base64')}`;
        const res = await get(`http://127.0.0.1:${fx.port}/?pos=1`, { Authorization: auth });
        expect(res.status).toBe(401);
    });
});
