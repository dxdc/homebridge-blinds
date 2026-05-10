import { describe, expect, it } from 'vitest';
import { applyPositionTemplate } from '../src/url-template';

describe('applyPositionTemplate', () => {
    it('returns null when no placeholder is present', () => {
        const result = applyPositionTemplate({ url: 'http://x/up', method: 'GET' }, 42);
        expect(result).toBeNull();
    });

    it('substitutes %%POS%% in URL', () => {
        const result = applyPositionTemplate({ url: 'http://x/set?pos=%%POS%%' }, 73);
        expect(result?.url).toBe('http://x/set?pos=73');
    });

    it('substitutes %%POS%% in string body', () => {
        const result = applyPositionTemplate({ url: 'http://x/set', body: '{"pos":"%%POS%%"}' }, 10);
        expect(result?.body).toBe('{"pos":"10"}');
    });

    it('substitutes "%%POSINT%%" without quotes for numeric JSON', () => {
        const result = applyPositionTemplate({ url: 'http://x/set', body: '{"pos":"%%POSINT%%"}' }, 10);
        expect(result?.body).toBe('{"pos":10}');
    });

    it('does not mutate the input endpoint', () => {
        const original = { url: 'http://x/set?pos=%%POS%%' };
        applyPositionTemplate(original, 50);
        expect(original.url).toBe('http://x/set?pos=%%POS%%');
    });

    it('substitutes inside object bodies via JSON round-trip', () => {
        const result = applyPositionTemplate({ url: 'http://x/set', body: { target: '%%POS%%' } }, 25);
        expect(result?.body).toEqual({ target: '25' });
    });

    it('does not leak regex state across calls', () => {
        const endpoint = { url: 'http://x/set?pos=%%POS%%' };
        // Run repeatedly: any global-flag lastIndex bug would alternate hits.
        for (let i = 0; i < 5; i++) {
            const r = applyPositionTemplate(endpoint, i);
            expect(r?.url).toBe(`http://x/set?pos=${i}`);
        }
    });
});
