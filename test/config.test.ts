import { describe, expect, it } from 'vitest';
import { normalizeConfig, RENAMED_KEYS } from '../src/config';
import { createTestLogger } from './test-utils';

describe('normalizeConfig', () => {
    it('applies sane defaults for a minimal config', () => {
        const log = createTestLogger();
        const cfg = normalizeConfig({ name: 'Window' }, log);
        expect(cfg.name).toBe('Window');
        expect(cfg.successCodes).toEqual([200]);
        expect(cfg.maxHttpAttempts).toBe(5);
        expect(cfg.commandRepeatCount).toBe(1);
        expect(cfg.invertPosition).toBe(false);
        expect(cfg.motionTimeGraph.up.length).toBeGreaterThan(0);
        expect(cfg.motionTimeGraph.down.length).toBeGreaterThan(0);
    });

    it('warns and applies legacy aliases', () => {
        const log = createTestLogger();
        const cfg = normalizeConfig(
            {
                name: 'Window',
                position_url: 'http://x/pos',
                position_interval: 30000,
                response_lag: 500,
            },
            log,
        );
        expect(cfg.positionUrl && cfg.positionUrl.url).toBe('http://x/pos');
        expect(cfg.positionPollInterval).toBe(30000);
        expect(cfg.responseLag).toBe(500);
        // Each renamed key should produce one warning.
        const warnings = log.lines.filter((l) => l.message.includes('renamed'));
        expect(warnings.length).toBeGreaterThanOrEqual(3);
    });

    it('clamps poll interval to the minimum', () => {
        const log = createTestLogger();
        const cfg = normalizeConfig({ name: 'Window', pos_poll_ms: 100 }, log);
        expect(cfg.positionPollInterval).toBe(5000);
    });

    it('coerces string endpoint to object', () => {
        const log = createTestLogger();
        const cfg = normalizeConfig({ name: 'W', up_url: 'http://x/up' }, log);
        expect(cfg.upUrl).toEqual({ url: 'http://x/up' });
    });

    it('rejects endpoint object missing url', () => {
        const log = createTestLogger();
        const cfg = normalizeConfig({ name: 'W', up_url: { method: 'GET' } }, log);
        expect(cfg.upUrl).toBe(false);
        expect(log.lines.some((l) => l.message.includes('No URL'))).toBe(true);
    });

    it('filters favorite buttons to integers in 0-100', () => {
        const log = createTestLogger();
        const cfg = normalizeConfig({ name: 'W', show_favorite_buttons: [25, 'bad', 200, -5, 50, 50] }, log);
        // De-duplicates and constrains to valid range.
        expect(cfg.showFavoriteButtons.sort()).toEqual([25, 50]);
    });

    it('honors invert_position', () => {
        const log = createTestLogger();
        expect(normalizeConfig({ name: 'W', invert_position: true }, log).invertPosition).toBe(true);
        expect(normalizeConfig({ name: 'W' }, log).invertPosition).toBe(false);
    });

    it('clamps commandRepeatCount to a minimum of 1', () => {
        const log = createTestLogger();
        expect(normalizeConfig({ name: 'W', command_repeat_count: 0 }, log).commandRepeatCount).toBe(1);
        expect(normalizeConfig({ name: 'W', command_repeat_count: 3 }, log).commandRepeatCount).toBe(3);
    });

    it('clamps obstructionThreshold to a minimum of 1', () => {
        const log = createTestLogger();
        expect(normalizeConfig({ name: 'W' }, log).obstructionThreshold).toBe(1);
        expect(normalizeConfig({ name: 'W', obstruction_threshold: 0 }, log).obstructionThreshold).toBe(1);
        expect(normalizeConfig({ name: 'W', obstruction_threshold: 3 }, log).obstructionThreshold).toBe(3);
    });

    it('parses set_debounce_ms with a floor of 0', () => {
        const log = createTestLogger();
        expect(normalizeConfig({ name: 'W' }, log).setDebounceMs).toBe(0);
        expect(normalizeConfig({ name: 'W', set_debounce_ms: 250 }, log).setDebounceMs).toBe(250);
        expect(normalizeConfig({ name: 'W', set_debounce_ms: -50 }, log).setDebounceMs).toBe(0);
    });

    it('parses battery options with sensible defaults and floors', () => {
        const log = createTestLogger();
        const cfg = normalizeConfig(
            {
                name: 'W',
                battery_url: 'http://x/battery',
                battery_jsonata: 'BatteryLevel',
                battery_low_threshold: 10,
            },
            log,
        );
        expect(cfg.batteryUrl && cfg.batteryUrl.url).toBe('http://x/battery');
        expect(cfg.batteryJsonata).toBe('BatteryLevel');
        expect(cfg.batteryPollInterval).toBeGreaterThanOrEqual(30000);
        expect(cfg.batteryLowThreshold).toBe(10);

        // Defaults
        const blank = normalizeConfig({ name: 'W' }, log);
        expect(blank.batteryUrl).toBe(false);
        expect(blank.batteryLowThreshold).toBe(20);
    });

    it('clamps battery_poll_ms to a minimum of 30 seconds', () => {
        const log = createTestLogger();
        const cfg = normalizeConfig({ name: 'W', battery_poll_ms: 1000 }, log);
        expect(cfg.batteryPollInterval).toBe(30000);
    });

    it('still honors legacy motion_up_time / motion_down_time', async () => {
        const { calculateMotionTime } = await import('../src/motion-graph');
        const log = createTestLogger();
        const cfg = normalizeConfig({ name: 'W', motion_up_time: 7000, motion_down_time: 13000 }, log);
        expect(calculateMotionTime(cfg.motionTimeGraph, 0, 100, true)).toBeCloseTo(7000);
        expect(calculateMotionTime(cfg.motionTimeGraph, 100, 0, false)).toBeCloseTo(13000);
        expect(log.lines.some((l) => l.message.includes('motion_up_time'))).toBe(true);
        expect(log.lines.some((l) => l.message.includes('motion_down_time'))).toBe(true);
    });

    it('still honors legacy http_method as the default request method', () => {
        const log = createTestLogger();
        const cfg = normalizeConfig({ name: 'W', http_method: 'PUT' }, log);
        expect(cfg.httpOptions.method).toBe('PUT');
        expect(log.lines.some((l) => l.message.includes('http_method'))).toBe(true);
    });

    it('still honors legacy max_http_attempts and retry_delay', () => {
        const log = createTestLogger();
        const cfg = normalizeConfig({ name: 'W', max_http_attempts: 7, retry_delay: 500 }, log);
        expect(cfg.maxHttpAttempts).toBe(7);
        expect(cfg.retryDelay).toBe(500);
    });

    it('exposes the renamed keys map', () => {
        expect(RENAMED_KEYS.position_url).toBe('pos_url');
        expect(RENAMED_KEYS.success_codes).toBe('http_success_codes');
    });
});
