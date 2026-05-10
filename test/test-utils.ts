import type { Logger } from '../src/types';

/**
 * Test logger that captures all log lines for later inspection. The harness
 * makes assertions about logged warnings (e.g. deprecation notices) so we
 * keep the log lines rather than discarding them.
 */
export function createTestLogger(): Logger & { lines: { level: string; message: string }[] } {
    const lines: { level: string; message: string }[] = [];
    const make = (level: string) => (msg: string) => {
        lines.push({ level, message: msg });
    };
    return {
        info: make('info'),
        warn: make('warn'),
        error: make('error'),
        debug: make('debug'),
        log: make('info'),
        lines,
    };
}

/**
 * In-process Homebridge API stand-in for integration tests. Captures the
 * `onGet`/`onSet` handlers registered against each characteristic so tests
 * can drive them directly without going through the Homebridge runtime.
 *
 * Only the surface area used by `BlindsAccessory` is implemented; missing
 * pieces will throw rather than silently no-op so tests catch regressions.
 */
export interface MockCharacteristic {
    name: string;
    value: unknown;
    onGetHandler?: () => unknown | Promise<unknown>;
    onSetHandler?: (value: unknown) => unknown | Promise<unknown>;
    on(event: string, handler: (...args: unknown[]) => unknown): MockCharacteristic;
    onGet(fn: () => unknown | Promise<unknown>): MockCharacteristic;
    onSet(fn: (value: unknown) => unknown | Promise<unknown>): MockCharacteristic;
    updateValue(v: unknown): MockCharacteristic;
}

export interface MockService {
    name: string;
    subtype?: string;
    characteristics: Map<string, MockCharacteristic>;
    getCharacteristic(name: unknown): MockCharacteristic;
    setCharacteristic(name: unknown, value: unknown): MockService;
}

export interface MockHap {
    Service: {
        WindowCovering: new (name: string) => MockService;
        AccessoryInformation: new () => MockService;
        Switch: new (name: string, subtype?: string) => MockService;
        Battery: new (name: string) => MockService;
    };
    Characteristic: Record<string, unknown>;
    uuid: { generate: (s: string) => string };
}

export interface MockApi {
    hap: MockHap;
    user: { persistPath: () => string };
    registerAccessory: (plugin: string, name: string, ctor: unknown) => void;
}

function createCharacteristic(name: string): MockCharacteristic {
    const c: MockCharacteristic = {
        name,
        value: undefined,
        on(_event, _handler) {
            return c;
        },
        onGet(fn) {
            c.onGetHandler = fn;
            return c;
        },
        onSet(fn) {
            c.onSetHandler = fn;
            return c;
        },
        updateValue(v) {
            c.value = v;
            return c;
        },
    };
    return c;
}

function createService(name: string, subtype?: string): MockService {
    const characteristics = new Map<string, MockCharacteristic>();
    const keyFor = (k: unknown): string => {
        // Real homebridge passes a class reference; we accept any object
        // with a `name` property (our characteristic identifiers do) or
        // fall back to the string representation.
        if (k && typeof k === 'object' && 'name' in k && typeof (k as { name: unknown }).name === 'string') {
            return (k as { name: string }).name;
        }
        return String(k);
    };
    const svc: MockService = {
        name,
        subtype,
        characteristics,
        getCharacteristic(charName) {
            const key = keyFor(charName);
            let c = characteristics.get(key);
            if (!c) {
                c = createCharacteristic(key);
                characteristics.set(key, c);
            }
            return c;
        },
        setCharacteristic(charName, value) {
            const c = svc.getCharacteristic(charName);
            c.value = value;
            // Drive the onSet handler if registered. Real homebridge does
            // this; replicating it here means the toggle/favorite buttons
            // (which internally call `setCharacteristic(TargetPosition, …)`)
            // actually trigger movement in tests.
            if (c.onSetHandler) {
                void Promise.resolve(c.onSetHandler(value));
            }
            return svc;
        },
    };
    return svc;
}

const SIMPLE_CHARS = [
    'CurrentPosition',
    'TargetPosition',
    'ObstructionDetected',
    'HoldPosition',
    'On',
    'Manufacturer',
    'Name',
    'Model',
    'SerialNumber',
    'FirmwareRevision',
    'BatteryLevel',
    'StatusLowBattery',
] as const;

/**
 * Build a Characteristic identifier object: looks like a class reference
 * but is just `{ name }` so the mock service can key on it. PositionState
 * additionally carries the STOPPED/INCREASING/DECREASING constants.
 */
function buildCharacteristicTable(): Record<string, unknown> {
    const table: Record<string, unknown> = {};
    for (const n of SIMPLE_CHARS) {
        table[n] = { name: n };
    }
    table.PositionState = { name: 'PositionState', STOPPED: 2, INCREASING: 1, DECREASING: 0 };
    table.ChargingState = { name: 'ChargingState', NOT_CHARGING: 0, CHARGING: 1, NOT_CHARGEABLE: 2 };
    return table;
}

export function createMockApi(
    persistDir: string,
): MockApi & { lastRegistration: { plugin: string; name: string; ctor: unknown } | null } {
    const api: MockApi & { lastRegistration: { plugin: string; name: string; ctor: unknown } | null } = {
        hap: {
            Service: {
                WindowCovering: function (this: MockService, name: string) {
                    return Object.assign(this, createService(name));
                } as unknown as new (name: string) => MockService,
                AccessoryInformation: function (this: MockService) {
                    return Object.assign(this, createService('Accessory Information'));
                } as unknown as new () => MockService,
                Switch: function (this: MockService, name: string, subtype?: string) {
                    return Object.assign(this, createService(name, subtype));
                } as unknown as new (name: string, subtype?: string) => MockService,
                Battery: function (this: MockService, name: string) {
                    return Object.assign(this, createService(name));
                } as unknown as new (name: string) => MockService,
            },
            Characteristic: buildCharacteristicTable(),
            uuid: { generate: (s) => `uuid-${s}` },
        },
        user: { persistPath: () => persistDir },
        registerAccessory: (plugin, name, ctor) => {
            api.lastRegistration = { plugin, name, ctor };
        },
        lastRegistration: null,
    };
    return api;
}
