import type { BlindsConfig, HttpEndpoint, Logger, MotionStep, MotionTimeGraph } from './types';

const MS_PER_SECOND = 1000;
const DEFAULT_MOTION_TIME_MS = 10_000;
const DEFAULT_POSITION_POLL_MS = 15_000;
const MIN_POSITION_POLL_MS = 5_000;
const DEFAULT_RETRY_DELAY_MS = 2_000;
const MIN_RETRY_DELAY_MS = 100;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_BATTERY_POLL_MS = 5 * 60_000;
const MIN_BATTERY_POLL_MS = 30_000;
const DEFAULT_BATTERY_LOW_THRESHOLD = 20;
const DEFAULT_SET_DEBOUNCE_MS = 0;

/** Renamed keys: still accepted, logged as a deprecation warning. */
export const RENAMED_KEYS: Readonly<Record<string, string>> = Object.freeze({
    map_send_jsonata: 'send_pos_jsonata',
    position_interval: 'pos_poll_ms',
    position_jsonata: 'pos_jsonata',
    position_url: 'pos_url',
    response_lag: 'response_lag_ms',
    success_codes: 'http_success_codes',
});

/** Keys still honored but slated for removal in a future major. */
const DEPRECATED_KEYS = [
    'http_method',
    'http_options',
    'max_http_attempts',
    'motion_down_time',
    'motion_up_time',
    'retry_delay',
] as const;

function firstDefined<T>(values: Array<T | undefined>): T | undefined {
    return values.find((v) => v !== undefined);
}

/** Coerce to integer with a fallback; the Homebridge UI often passes strings. */
function toInt(value: unknown, fallback: number, minimum?: number): number {
    let n: number;
    if (typeof value === 'number') {
        n = Math.trunc(value);
    } else if (typeof value === 'string') {
        n = parseInt(value, 10);
    } else {
        n = NaN;
    }
    if (!Number.isFinite(n)) n = fallback;
    if (minimum !== undefined && n < minimum) n = minimum;
    return n;
}

/** String or object → `HttpEndpoint`; `false` when unresolvable. */
function normalizeEndpoint(value: unknown, log: Logger, label: string): HttpEndpoint | false {
    if (!value) return false;
    if (typeof value === 'string') {
        return { url: value };
    }
    if (typeof value === 'object') {
        const obj = value as Partial<HttpEndpoint>;
        if (!obj.url) {
            log.info(`No URL found for ${label}`);
            return false;
        }
        return { ...obj, url: obj.url } as HttpEndpoint;
    }
    return false;
}

function defaultGraph(upMs: number, downMs: number): MotionTimeGraph {
    return {
        up: [
            { pos: 0, seconds: 0 },
            { pos: 100, seconds: upMs / MS_PER_SECOND },
        ],
        down: [
            { pos: 100, seconds: 0 },
            { pos: 0, seconds: downMs / MS_PER_SECOND },
        ],
    };
}

/** Sort, validate, and precompute `motionTimeStep` for one direction. */
export function prepareMotionGraph(
    steps: MotionStep[] | undefined,
    direction: 'up' | 'down',
    log: Logger,
): MotionStep[] {
    if (!steps || !Array.isArray(steps) || steps.length === 0) {
        log.error(`Motion '${direction}' graph is undefined!`);
        return [];
    }

    const sorted = [...steps].sort((a, b) => a.pos - b.pos);
    const filtered = sorted.filter((step) => {
        if (step.pos < 0 || step.pos > 100) {
            log.error(
                `Motion '${direction}' step was skipped (invalid: pos must be between 0-100): ${JSON.stringify(step)}`,
            );
            return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        log.error(`Motion '${direction}' graph has no steps!`);
        return [];
    }

    if (filtered[0].pos !== 0 || filtered[filtered.length - 1].pos !== 100) {
        const availablePos = filtered.map((s) => s.pos);
        log.error(
            `Motion '${direction}' graph is missing definitions for positions 0 and/or 100: (found: ${availablePos})`,
        );
        return [];
    }

    for (let i = 1; i < filtered.length; i++) {
        const prev = filtered[i - 1];
        const cur = filtered[i];
        const deltaSeconds = Math.abs(cur.seconds - prev.seconds);
        const deltaPos = cur.pos - prev.pos;
        if (deltaSeconds > 0 && deltaPos > 0) {
            cur.motionTimeStep = deltaSeconds / deltaPos;
        } else {
            log.error(
                `Motion '${direction}' step was skipped, ${deltaSeconds} seconds from previous step, +${deltaPos} position from previous step: ${JSON.stringify(cur)}`,
            );
        }
    }

    return filtered;
}

/** Single boundary between raw user config and the rest of the plugin. */
export function normalizeConfig(raw: Record<string, unknown>, log: Logger): BlindsConfig {
    if (!raw || typeof raw !== 'object') {
        throw new Error('No configuration provided to homebridge-blinds');
    }

    for (const oldKey of Object.keys(RENAMED_KEYS)) {
        if (raw[oldKey] !== undefined) {
            log.error(
                `Config parameter '${oldKey}' has been renamed to '${RENAMED_KEYS[oldKey]}'; please update your settings`,
            );
        }
    }
    for (const key of DEPRECATED_KEYS) {
        if (raw[key] !== undefined) {
            log.error(
                `Config parameter '${key}' is deprecated; please migrate to the current format (see documentation)`,
            );
        }
    }

    const upUrl = normalizeEndpoint(raw.up_url, log, 'up_url');
    const downUrl = normalizeEndpoint(raw.down_url, log, 'down_url');
    const stopUrl = normalizeEndpoint(raw.stop_url, log, 'stop_url');
    const positionUrlRaw = firstDefined([raw.pos_url, (raw as Record<string, unknown>).position_url]);
    const positionUrl = positionUrlRaw ? normalizeEndpoint(positionUrlRaw, log, 'pos_url') : false;

    const positionPollInterval = toInt(
        firstDefined([raw.pos_poll_ms, (raw as Record<string, unknown>).position_interval]),
        DEFAULT_POSITION_POLL_MS,
        MIN_POSITION_POLL_MS,
    );

    const responseLag = toInt(firstDefined([raw.response_lag_ms, (raw as Record<string, unknown>).response_lag]), 0, 0);

    const positionJsonata =
        (firstDefined([raw.pos_jsonata, (raw as Record<string, unknown>).position_jsonata]) as string | undefined) ||
        false;
    const sendPositionJsonata =
        (firstDefined([raw.send_pos_jsonata, (raw as Record<string, unknown>).map_send_jsonata]) as
            | string
            | undefined) || false;

    // Fallback merged into every request that doesn't specify its own
    // method/headers/body. String form (just the method) is coerced to
    // an object for uniform handling.
    const rawHttpOptions = firstDefined([raw.http_options, (raw as Record<string, unknown>).http_method]) as
        | string
        | Partial<HttpEndpoint>
        | undefined;
    const httpOptions: Partial<HttpEndpoint> =
        typeof rawHttpOptions === 'string' ? { method: rawHttpOptions } : (rawHttpOptions ?? { method: 'POST' });

    const successCodes = (firstDefined([raw.http_success_codes, (raw as Record<string, unknown>).success_codes]) as
        | number[]
        | undefined) ?? [200];

    const maxHttpAttempts = Math.max(toInt(raw.max_http_attempts, DEFAULT_MAX_ATTEMPTS), 1);
    const retryDelay = toInt(raw.retry_delay, DEFAULT_RETRY_DELAY_MS, MIN_RETRY_DELAY_MS);
    const requestTimeout = toInt(raw.request_timeout_ms, DEFAULT_REQUEST_TIMEOUT_MS, 100);
    const commandRepeatCount = Math.max(toInt(raw.command_repeat_count, 1), 1);
    const obstructionThreshold = Math.max(toInt(raw.obstruction_threshold, 1), 1);
    const setDebounceMs = Math.max(toInt(raw.set_debounce_ms, DEFAULT_SET_DEBOUNCE_MS, 0), 0);

    const batteryUrl = raw.battery_url ? normalizeEndpoint(raw.battery_url, log, 'battery_url') : false;
    const batteryPollInterval = toInt(raw.battery_poll_ms, DEFAULT_BATTERY_POLL_MS, MIN_BATTERY_POLL_MS);
    const batteryJsonata = (raw.battery_jsonata as string | undefined) || false;
    const batteryLowThreshold = Math.min(
        Math.max(toInt(raw.battery_low_threshold, DEFAULT_BATTERY_LOW_THRESHOLD, 0), 0),
        100,
    );

    const motionTimeBase = toInt(raw.motion_time, DEFAULT_MOTION_TIME_MS);
    const motionUpMs = toInt(raw.motion_up_time, motionTimeBase);
    const motionDownMs = toInt(raw.motion_down_time, motionTimeBase);
    const rawGraph = raw.motion_time_graph as Partial<MotionTimeGraph> | undefined;
    const motionTimeGraph: MotionTimeGraph = rawGraph
        ? {
              up: prepareMotionGraph(rawGraph.up, 'up', log),
              down: prepareMotionGraph(rawGraph.down, 'down', log),
          }
        : (() => {
              const g = defaultGraph(motionUpMs, motionDownMs);
              g.up = prepareMotionGraph(g.up, 'up', log);
              g.down = prepareMotionGraph(g.down, 'down', log);
              return g;
          })();

    const favoritesRaw = (raw.show_favorite_buttons as unknown[] | undefined) ?? [];
    const showFavoriteButtons = Array.from(
        new Set(
            favoritesRaw.filter((v): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100),
        ),
    );

    return {
        name: String(raw.name ?? 'Blinds'),
        upUrl,
        downUrl,
        stopUrl,
        positionUrl,
        positionPollInterval,
        positionJsonata,
        sendPositionJsonata,
        successCodes,
        httpOptions,
        maxHttpAttempts,
        retryDelay,
        requestTimeout,
        commandRepeatCount,
        obstructionThreshold,
        setDebounceMs,
        batteryUrl,
        batteryPollInterval,
        batteryJsonata,
        batteryLowThreshold,
        webhookPort: toInt(raw.webhook_port, 0, 0),
        webhookHttps: raw.webhook_https === true,
        webhookHttpsKeyFile: (raw.webhook_https_keyfile as string | undefined) || false,
        webhookHttpsCertFile: (raw.webhook_https_certfile as string | undefined) || false,
        webhookHttpAuthUser: (raw.webhook_http_auth_user as string | undefined) || false,
        webhookHttpAuthPass: (raw.webhook_http_auth_pass as string | undefined) || false,
        showStopButton: raw.show_stop_button === true,
        showToggleButton: raw.show_toggle_button === true,
        showFavoriteButtons,
        motionTimeGraph,
        responseLag,
        invertPosition: raw.invert_position === true,
        uniqueSerial: raw.unique_serial === true,
        triggerStopAtBoundaries: raw.trigger_stop_at_boundaries === true,
        useSameUrlForStop: raw.use_same_url_for_stop === true,
        verbose: raw.verbose === true,
    };
}
