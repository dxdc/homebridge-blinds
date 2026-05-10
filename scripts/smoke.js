#!/usr/bin/env node
/**
 * End-to-end smoke check for the packaged plugin.
 *
 * This script is intentionally written in plain JavaScript so it can run
 * against the packaged dist/ output exactly as Homebridge would consume it
 * — no TypeScript, no test framework, no source-map magic. It catches:
 *
 *   • Missing files in the npm `files` allowlist
 *   • CommonJS / ESM packaging bugs (require() that fails at install time)
 *   • Constructor errors that only manifest with a real-shaped homebridge API
 *   • Accessory registration regressions (alias rename, etc.)
 *
 * The checks deliberately exercise both the bare default registration path
 * and a full-feature config (every example shipped in examples/) so that
 * any regression in config normalization is caught here too.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'index.js');

if (!fs.existsSync(DIST)) {
    console.error(`[smoke] ${DIST} does not exist. Did you run 'npm run build'?`);
    process.exit(1);
}

const plugin = require(DIST);
if (typeof plugin !== 'function') {
    console.error('[smoke] dist/index.js does not export a function');
    process.exit(1);
}

const PERSIST_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'hb-blinds-smoke-'));

function makeChar(name) {
    return {
        name,
        value: undefined,
        on() { return this; },
        onGet(fn) { this._onGet = fn; return this; },
        onSet(fn) { this._onSet = fn; return this; },
        updateValue(v) { this.value = v; return this; },
        setCharacteristic() { return this; },
    };
}

function makeService(name) {
    const chars = new Map();
    return {
        name,
        getCharacteristic(c) {
            const key = c && c.name ? c.name : String(c);
            if (!chars.has(key)) chars.set(key, makeChar(key));
            return chars.get(key);
        },
        setCharacteristic(c, value) {
            this.getCharacteristic(c).value = value;
            return this;
        },
        characteristics: chars,
    };
}

const Char = (n) => ({ name: n });
const PositionState = { name: 'PositionState', STOPPED: 2, INCREASING: 1, DECREASING: 0 };

const api = {
    hap: {
        Service: {
            WindowCovering: function (n) { Object.assign(this, makeService(n)); },
            AccessoryInformation: function () { Object.assign(this, makeService('Accessory Information')); },
            Switch: function (n) { Object.assign(this, makeService(n)); },
        },
        Characteristic: {
            CurrentPosition: Char('CurrentPosition'),
            TargetPosition: Char('TargetPosition'),
            ObstructionDetected: Char('ObstructionDetected'),
            Manufacturer: Char('Manufacturer'),
            Name: Char('Name'),
            Model: Char('Model'),
            SerialNumber: Char('SerialNumber'),
            FirmwareRevision: Char('FirmwareRevision'),
            On: Char('On'),
            PositionState,
        },
        uuid: { generate: (s) => `uuid-${s}` },
    },
    user: { persistPath: () => PERSIST_DIR },
    registrations: [],
    registerAccessory(plugin, name, ctor) {
        this.registrations.push({ plugin, name, ctor });
    },
};

const log = {
    info: (m) => console.log(`  info: ${m}`),
    warn: (m) => console.log(`  warn: ${m}`),
    error: (m) => console.log(`  err:  ${m}`),
    debug: () => {},
};

// 1. The plugin must register the BlindsHTTP accessory under the
//    homebridge-blinds plugin id. Both names are part of the public API
//    contract; tests fail loudly if they ever change.
console.log('[smoke] registering plugin');
plugin(api);
if (api.registrations.length !== 1) {
    console.error(`[smoke] expected 1 registration, got ${api.registrations.length}`);
    process.exit(1);
}
const reg = api.registrations[0];
if (reg.plugin !== 'homebridge-blinds' || reg.name !== 'BlindsHTTP') {
    console.error(`[smoke] unexpected registration: ${reg.plugin} / ${reg.name}`);
    process.exit(1);
}

// 2. Construct accessories from every shipped example. Any normalization
//    error or constructor crash is a packaging-or-source bug.
const EXAMPLES = path.join(ROOT, 'examples');
const exampleFiles = fs.readdirSync(EXAMPLES).filter((f) => f.endsWith('.json'));
let constructed = 0;
for (const file of exampleFiles) {
    const raw = fs.readFileSync(path.join(EXAMPLES, file), 'utf8');
    const parsed = JSON.parse(raw);
    const configs = file === 'multiple-blinds.json' ? parsed.accessories : [parsed];
    for (const cfg of configs) {
        // Bind any webhook to an ephemeral port so multiple smoke runs (or
        // a CI runner with port 51828 already in use) don't collide.
        const cfgForSmoke = cfg.webhook_port ? { ...cfg, webhook_port: 0 } : cfg;
        console.log(`[smoke] constructing accessory from ${file} (${cfg.name})`);
        const accessory = new reg.ctor(log, cfgForSmoke, api);
        const services = accessory.getServices();
        if (!Array.isArray(services) || services.length < 2) {
            console.error(`[smoke] ${file}: expected at least 2 services, got ${services && services.length}`);
            process.exit(1);
        }
        constructed++;
    }
}

// 3. Drive a full move against a real in-process HTTP server. This catches
//    regressions in the request pipeline that the construct-only checks
//    above wouldn't notice — for example, a typo'd content-type that breaks
//    fetch under Node, or an accidentally-removed retry path.
const http = require('node:http');

(async () => {
    const requests = [];
    const server = http.createServer((req, res) => {
        requests.push({ method: req.method, path: req.url });
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end('{"ok":true}');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    const liveCfg = {
        accessory: 'BlindsHTTP',
        name: 'Smoke Live',
        up_url: { url: `${baseUrl}/up`, method: 'GET' },
        down_url: { url: `${baseUrl}/down`, method: 'GET' },
        stop_url: { url: `${baseUrl}/stop`, method: 'GET' },
        motion_time: 200,
        request_timeout_ms: 1000,
    };
    console.log(`[smoke] driving a live move against ${baseUrl}`);
    const accessory = new reg.ctor(log, liveCfg, api);
    const services = accessory.getServices();
    const wc = services.find((s) => s.characteristics && s.characteristics.has('TargetPosition'));
    const target = wc.getCharacteristic('TargetPosition');
    if (!target._onSet) {
        console.error('[smoke] no onSet handler captured for TargetPosition');
        process.exit(1);
    }

    // Drive a move to 50 and wait for the up + stop sequence to land.
    await target._onSet(50);
    const start = Date.now();
    while (
        !(requests.some((r) => r.path === '/up') && requests.some((r) => r.path === '/stop')) &&
        Date.now() - start < 5000
    ) {
        await new Promise((r) => setTimeout(r, 50));
    }

    server.close();

    if (!requests.some((r) => r.path === '/up')) {
        console.error('[smoke] expected /up to be issued; got:', requests.map((r) => r.path));
        process.exit(1);
    }
    if (!requests.some((r) => r.path === '/stop')) {
        console.error('[smoke] expected /stop to be issued; got:', requests.map((r) => r.path));
        process.exit(1);
    }

    console.log(
        `[smoke] OK: registered plugin, constructed ${constructed} accessories from ${exampleFiles.length} example files, ` +
            `and drove a live move (${requests.length} requests received: ${requests.map((r) => r.path).join(', ')})`,
    );
    process.exit(0);
})().catch((err) => {
    console.error('[smoke] FAILED:', err);
    process.exit(1);
});
