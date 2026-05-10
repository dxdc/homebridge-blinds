import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage } from '../src/storage';

describe('Storage', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'hb-blinds-storage-'));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('returns undefined for missing keys', () => {
        const s = new Storage(dir);
        expect(s.getItemSync('missing')).toBeUndefined();
    });

    it('round-trips numeric values', () => {
        const s = new Storage(dir);
        s.setItemSync('window', 73);
        expect(s.getItemSync<number>('window')).toBe(73);
    });

    it('round-trips object values', () => {
        const s = new Storage(dir);
        s.setItemSync('cert', { private: 'k', cert: 'c' });
        expect(s.getItemSync<{ private: string; cert: string }>('cert')).toEqual({
            private: 'k',
            cert: 'c',
        });
    });

    it('reads node-persist@2 legacy format', () => {
        // Existing installs from v2.x have files written in this exact shape.
        writeFileSync(join(dir, 'window'), JSON.stringify({ key: 'window', value: 42 }));
        const s = new Storage(dir);
        expect(s.getItemSync<number>('window')).toBe(42);
    });

    it('treats corrupt files as missing', () => {
        writeFileSync(join(dir, 'broken'), 'not json');
        const s = new Storage(dir);
        expect(s.getItemSync('broken')).toBeUndefined();
    });

    it('sanitizes path separators in keys', () => {
        const s = new Storage(dir);
        s.setItemSync('a/b', 1);
        expect(s.getItemSync<number>('a/b')).toBe(1);
    });
});
