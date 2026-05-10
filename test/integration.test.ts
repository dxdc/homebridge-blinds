import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, IncomingMessage, type Server, ServerResponse } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';

import { BlindsAccessory } from '../src/accessory';
import type { MockApi, MockCharacteristic, MockService } from './test-utils';
import { createMockApi, createTestLogger } from './test-utils';
import type { Logger } from '../src/types';

interface Recorded {
    method: string;
    path: string;
    body: string;
    headers: Record<string, string | string[] | undefined>;
}

interface FakeDevice {
    server: Server;
    baseUrl: string;
    /** Every request received, in order. */
    requests: Recorded[];
    /** Position the device reports via /position. Mutate to simulate motion. */
    reportedPosition: number;
    close: () => Promise<void>;
}

/**
 * Spin up an in-process HTTP server that records every request and returns
 * the `reportedPosition` field as JSON for `/position`. The server listens on
 * an ephemeral port so tests can run concurrently.
 */
async function startFakeDevice(): Promise<FakeDevice> {
    const requests: Recorded[] = [];
    const device: FakeDevice = {
        server: undefined as unknown as Server,
        baseUrl: '',
        requests,
        reportedPosition: 0,
        close: async () => {
            await new Promise<void>((resolve) => device.server.close(() => resolve()));
        },
    };

    const handler = (req: IncomingMessage, res: ServerResponse): void => {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            const body = Buffer.concat(chunks).toString();
            requests.push({
                method: req.method ?? 'GET',
                path: req.url ?? '/',
                body,
                headers: req.headers as Recorded['headers'],
            });
            res.setHeader('Content-Type', 'application/json');
            if (req.url?.startsWith('/position')) {
                res.statusCode = 200;
                res.end(JSON.stringify({ ShutterPosition1: device.reportedPosition }));
                return;
            }
            res.statusCode = 200;
            res.end('{"ok":true}');
        });
    };

    device.server = createServer(handler);
    await new Promise<void>((resolve) => device.server.listen(0, '127.0.0.1', resolve));
    const addr = device.server.address() as AddressInfo;
    device.baseUrl = `http://127.0.0.1:${addr.port}`;
    return device;
}

interface Harness {
    accessory: BlindsAccessory;
    api: MockApi;
    log: Logger & { lines: { level: string; message: string }[] };
    windowCovering: MockService;
    targetPosition: MockCharacteristic;
    currentPosition: MockCharacteristic;
}

function buildAccessory(persistDir: string, config: Record<string, unknown>): Harness {
    const log = createTestLogger();
    const api = createMockApi(persistDir);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accessory = new BlindsAccessory(log as any, config as any, api as any);
    const services = accessory.getServices() as unknown as MockService[];
    const windowCovering = services.find((s) => s.characteristics.has('TargetPosition'))!;
    return {
        accessory,
        api,
        log,
        windowCovering,
        targetPosition: windowCovering.getCharacteristic('TargetPosition'),
        currentPosition: windowCovering.getCharacteristic('CurrentPosition'),
    };
}

/**
 * Drive a TargetPosition.set and wait for the accessory to finish all the
 * follow-up async work (HTTP request, optional stop, motion emulation, final
 * polling). Returns when the position state has settled to STOPPED.
 */
async function setTarget(h: Harness, value: number, timeoutMs = 4000): Promise<void> {
    const handler = h.targetPosition.onSetHandler;
    if (!handler) throw new Error('TargetPosition.onSet handler not registered');
    await handler(value);
    const positionState = h.windowCovering.getCharacteristic('PositionState');
    const start = Date.now();
    while (positionState.value !== 2) {
        if (Date.now() - start > timeoutMs) {
            throw new Error(`Timed out waiting for PositionState=STOPPED (got ${String(positionState.value)})`);
        }
        await new Promise((r) => setTimeout(r, 25));
    }
}

describe('integration: BlindsAccessory ↔ live HTTP server', () => {
    let device: FakeDevice;
    let persistDir: string;

    beforeEach(async () => {
        device = await startFakeDevice();
        persistDir = mkdtempSync(join(tmpdir(), 'hb-blinds-int-'));
    });

    afterEach(async () => {
        await device.close();
        rmSync(persistDir, { recursive: true, force: true });
    });

    it('issues up_url + stop_url for an intermediate target', async () => {
        const h = buildAccessory(persistDir, {
            accessory: 'BlindsHTTP',
            name: 'Test Window',
            up_url: { url: `${device.baseUrl}/up`, method: 'GET' },
            down_url: { url: `${device.baseUrl}/down`, method: 'GET' },
            stop_url: { url: `${device.baseUrl}/stop`, method: 'GET' },
            motion_time: 200,
        });

        await setTarget(h, 50);

        const paths = device.requests.map((r) => r.path);
        expect(paths).toContain('/up');
        expect(paths).toContain('/stop');
        expect(h.currentPosition.value).toBe(50);
    });

    it('skips stop when the URL contains %%POS%% (exact-position mode)', async () => {
        const h = buildAccessory(persistDir, {
            accessory: 'BlindsHTTP',
            name: 'Test Window',
            up_url: { url: `${device.baseUrl}/set?pos=%%POS%%`, method: 'GET' },
            down_url: { url: `${device.baseUrl}/set?pos=%%POS%%`, method: 'GET' },
            motion_time: 200,
        });

        await setTarget(h, 30);

        const paths = device.requests.map((r) => r.path);
        expect(paths.some((p) => p.startsWith('/set?pos=30'))).toBe(true);
        expect(paths).not.toContain('/stop');
    });

    it('repeats the move command N times when command_repeat_count > 1', async () => {
        const h = buildAccessory(persistDir, {
            accessory: 'BlindsHTTP',
            name: 'Test Window',
            up_url: { url: `${device.baseUrl}/up`, method: 'GET' },
            down_url: { url: `${device.baseUrl}/down`, method: 'GET' },
            stop_url: { url: `${device.baseUrl}/stop`, method: 'GET' },
            motion_time: 200,
            command_repeat_count: 3,
        });

        await setTarget(h, 100);
        const upCount = device.requests.filter((r) => r.path === '/up').length;
        expect(upCount).toBe(3);
    });

    it('inverts position semantics when invert_position is true', async () => {
        // With invert: HomeKit 0 maps to internal 100 (move "up" from default 0).
        const h = buildAccessory(persistDir, {
            accessory: 'BlindsHTTP',
            name: 'Awning',
            up_url: { url: `${device.baseUrl}/up`, method: 'GET' },
            down_url: { url: `${device.baseUrl}/down`, method: 'GET' },
            stop_url: { url: `${device.baseUrl}/stop`, method: 'GET' },
            motion_time: 200,
            invert_position: true,
        });

        // HomeKit target 0 → internal 100 → up command issued.
        await setTarget(h, 0);
        expect(device.requests.some((r) => r.path === '/up')).toBe(true);
    });

    it('uses pos_url + JSONata to read the real device position', async () => {
        device.reportedPosition = 73;
        const h = buildAccessory(persistDir, {
            accessory: 'BlindsHTTP',
            name: 'Test Window',
            up_url: { url: `${device.baseUrl}/up`, method: 'GET' },
            down_url: { url: `${device.baseUrl}/down`, method: 'GET' },
            stop_url: { url: `${device.baseUrl}/stop`, method: 'GET' },
            pos_url: `${device.baseUrl}/position`,
            pos_jsonata: 'ShutterPosition1',
            motion_time: 200,
        });

        // Wait for the initial poll fired in setImmediate.
        for (let i = 0; i < 40 && h.currentPosition.value !== 73; i++) {
            await new Promise((r) => setTimeout(r, 25));
        }
        expect(h.currentPosition.value).toBe(73);
        expect(device.requests.some((r) => r.path.startsWith('/position'))).toBe(true);
    });

    it('persists last position across restarts', async () => {
        const config = {
            accessory: 'BlindsHTTP',
            name: 'Persisted',
            up_url: { url: `${device.baseUrl}/up`, method: 'GET' },
            down_url: { url: `${device.baseUrl}/down`, method: 'GET' },
            stop_url: { url: `${device.baseUrl}/stop`, method: 'GET' },
            motion_time: 200,
        };
        const first = buildAccessory(persistDir, config);
        await setTarget(first, 60);
        // New accessory instance pointed at the same persist dir should
        // pick up the previously stored position.
        const second = buildAccessory(persistDir, config);
        expect(second.currentPosition.value).toBeUndefined();
        // The persisted value drives the initial `lastPosition`; verify
        // by issuing a "move" to the same value, which should short-circuit.
        await setTarget(second, 60);
        const moveLog = second.log.lines.find((l) => l.message.includes('Already there'));
        expect(moveLog).toBeDefined();
    });

    it('sets ObstructionDetected when the device is unreachable', async () => {
        // Point at a guaranteed-unused port to force connection refused.
        const h = buildAccessory(persistDir, {
            accessory: 'BlindsHTTP',
            name: 'Broken',
            up_url: { url: 'http://127.0.0.1:1/up', method: 'GET' },
            down_url: { url: 'http://127.0.0.1:1/down', method: 'GET' },
            motion_time: 100,
            request_timeout_ms: 200,
            max_http_attempts: 1,
        });

        const handler = h.targetPosition.onSetHandler!;
        await handler(50);
        // Give the failing fetch a beat to settle.
        for (let i = 0; i < 40; i++) {
            const ob = h.windowCovering.getCharacteristic('ObstructionDetected').value;
            if (ob === true) break;
            await new Promise((r) => setTimeout(r, 25));
        }
        expect(h.windowCovering.getCharacteristic('ObstructionDetected').value).toBe(true);
    });

    it('honors obstruction_threshold to filter transient failures', async () => {
        const h = buildAccessory(persistDir, {
            accessory: 'BlindsHTTP',
            name: 'Threshold',
            up_url: { url: 'http://127.0.0.1:1/up', method: 'GET' },
            down_url: { url: 'http://127.0.0.1:1/down', method: 'GET' },
            motion_time: 100,
            request_timeout_ms: 200,
            max_http_attempts: 1,
            obstruction_threshold: 3,
        });

        // First failure: should NOT trip obstruction yet.
        await h.targetPosition.onSetHandler!(50);
        await new Promise((r) => setTimeout(r, 600));
        expect(h.windowCovering.getCharacteristic('ObstructionDetected').value).toBe(false);

        // Second failure: still under threshold.
        await h.targetPosition.onSetHandler!(60);
        await new Promise((r) => setTimeout(r, 600));
        expect(h.windowCovering.getCharacteristic('ObstructionDetected').value).toBe(false);

        // Third failure: now we trip.
        await h.targetPosition.onSetHandler!(70);
        for (let i = 0; i < 30; i++) {
            if (h.windowCovering.getCharacteristic('ObstructionDetected').value === true) break;
            await new Promise((r) => setTimeout(r, 25));
        }
        expect(h.windowCovering.getCharacteristic('ObstructionDetected').value).toBe(true);
    });

    it('coalesces rapid TargetPosition events when set_debounce_ms is set', async () => {
        const h = buildAccessory(persistDir, {
            accessory: 'BlindsHTTP',
            name: 'Debounced',
            up_url: { url: `${device.baseUrl}/up`, method: 'GET' },
            down_url: { url: `${device.baseUrl}/down`, method: 'GET' },
            stop_url: { url: `${device.baseUrl}/stop`, method: 'GET' },
            motion_time: 200,
            set_debounce_ms: 80,
        });

        // Simulate the Home app dragging the slider — many rapid sets.
        const handler = h.targetPosition.onSetHandler!;
        await handler(20);
        await handler(40);
        await handler(60);
        await handler(80);

        // Before the debounce window expires, no requests should have fired.
        expect(device.requests.filter((r) => r.path === '/up').length).toBe(0);

        // Wait past the debounce window plus emulated motion.
        await new Promise((r) => setTimeout(r, 150));
        const positionState = h.windowCovering.getCharacteristic('PositionState');
        const start = Date.now();
        while (positionState.value !== 2 && Date.now() - start < 4000) {
            await new Promise((r) => setTimeout(r, 25));
        }
        // Exactly one move command should have been issued — for the
        // final value (80, which moves up from 0).
        expect(device.requests.filter((r) => r.path === '/up').length).toBe(1);
    });

    it('exposes a Battery service when battery_url is configured', async () => {
        // The fake device serves the same JSON ({ ShutterPosition1: N })
        // from /position regardless of intent, so we point battery_url at
        // it and pre-set reportedPosition to the level we want to assert.
        device.reportedPosition = 15;
        const h = buildAccessory(persistDir, {
            accessory: 'BlindsHTTP',
            name: 'Battery Blind',
            up_url: { url: `${device.baseUrl}/up`, method: 'GET' },
            down_url: { url: `${device.baseUrl}/down`, method: 'GET' },
            motion_time: 200,
            battery_url: `${device.baseUrl}/position`,
            battery_poll_ms: 30000,
            battery_jsonata: 'ShutterPosition1',
            battery_low_threshold: 25,
        });

        const services = h.accessory.getServices() as unknown as MockService[];
        const batteryService = services.find((s) => s.name?.endsWith('Battery'));
        expect(batteryService).toBeDefined();

        // Wait for the initial poll fired in setImmediate to land.
        for (let i = 0; i < 40; i++) {
            const lvl = batteryService!.getCharacteristic('BatteryLevel').value;
            if (lvl === 15) break;
            await new Promise((r) => setTimeout(r, 25));
        }
        expect(batteryService!.getCharacteristic('BatteryLevel').value).toBe(15);
        expect(batteryService!.getCharacteristic('StatusLowBattery').value).toBe(1);
    });

    it('exposes a HoldPosition characteristic that triggers a stop request', async () => {
        const h = buildAccessory(persistDir, {
            accessory: 'BlindsHTTP',
            name: 'Hold-Capable',
            up_url: { url: `${device.baseUrl}/up`, method: 'GET' },
            down_url: { url: `${device.baseUrl}/down`, method: 'GET' },
            stop_url: { url: `${device.baseUrl}/stop`, method: 'GET' },
            motion_time: 200,
        });

        const hold = h.windowCovering.getCharacteristic('HoldPosition');
        expect(hold.onSetHandler).toBeDefined();
        await hold.onSetHandler!(true);
        // Wait briefly for the underlying httpClient.request to complete.
        for (let i = 0; i < 40; i++) {
            if (device.requests.some((r) => r.path === '/stop')) break;
            await new Promise((r) => setTimeout(r, 25));
        }
        expect(device.requests.some((r) => r.path === '/stop')).toBe(true);
    });

    it('returns lastPosition immediately from CurrentPosition.onGet (non-blocking)', async () => {
        const h = buildAccessory(persistDir, {
            accessory: 'BlindsHTTP',
            name: 'Fast',
            up_url: { url: `${device.baseUrl}/up`, method: 'GET' },
            down_url: { url: `${device.baseUrl}/down`, method: 'GET' },
            motion_time: 100,
            // pos_url is intentionally omitted so the handler must return
            // without any I/O. This verifies #84 is fixed.
        });

        const start = Date.now();
        const value = await h.currentPosition.onGetHandler!();
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(20); // synchronous-ish
        expect(typeof value).toBe('number');
    });
});
