import { describe, expect, it } from 'vitest';
import { JsonataExpression } from '../src/jsonata-helper';
import { createTestLogger } from './test-utils';

describe('JsonataExpression', () => {
    it('returns null for falsy expression', () => {
        const log = createTestLogger();
        expect(JsonataExpression.compile('', 'test', log)).toBeNull();
        expect(JsonataExpression.compile(false, 'test', log)).toBeNull();
    });

    it('compiles and evaluates a simple expression', async () => {
        const log = createTestLogger();
        const expr = JsonataExpression.compile('ShutterPosition1', 'pos', log);
        expect(expr).not.toBeNull();
        const result = await expr!.evaluate({ ShutterPosition1: 73 });
        expect(result).toBe(73);
    });

    it('logs error and returns null on invalid expression', () => {
        const log = createTestLogger();
        const expr = JsonataExpression.compile('!!!', 'pos', log);
        expect(expr).toBeNull();
        expect(log.lines.some((l) => l.level === 'error' && l.message.includes('pos'))).toBe(true);
    });

    it('supports the documented send_pos_jsonata example', async () => {
        const log = createTestLogger();
        const expr = JsonataExpression.compile('$round( ( 100 - $number($) ) * 255 / 100 )', 'send', log);
        // 100 - 80 = 20; 20 * 255 / 100 = 51
        expect(await expr!.evaluate(80)).toBe(51);
    });
});
