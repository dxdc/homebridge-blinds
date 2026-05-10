import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeConfig } from '../src/config';
import { createTestLogger } from './test-utils';

const EXAMPLES_DIR = join(__dirname, '..', 'examples');

/**
 * Smoke test: every shipped example config must parse as valid JSON and
 * normalize without errors. The `multiple-blinds.json` file is structured
 * differently (an `accessories` array) and is special-cased below.
 */
describe('shipped example configurations', () => {
    const files = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith('.json'));

    it.each(files)('parses %s', (file) => {
        const raw = readFileSync(join(EXAMPLES_DIR, file), 'utf8');
        const parsed = JSON.parse(raw);
        const log = createTestLogger();
        if (file === 'multiple-blinds.json') {
            // This example is a config.json snippet rather than a single
            // accessory. Each entry in `accessories` should normalize.
            expect(Array.isArray(parsed.accessories)).toBe(true);
            for (const accessory of parsed.accessories) {
                const cfg = normalizeConfig(accessory, log);
                expect(cfg.name).toBeTruthy();
            }
            return;
        }
        const cfg = normalizeConfig(parsed, log);
        expect(cfg.name).toBeTruthy();
        // No deprecation warnings should be emitted for examples — they
        // should always demonstrate the current canonical key names.
        const renamed = log.lines.filter((l) => l.message.includes('renamed'));
        expect(renamed, `${file} uses deprecated keys: ${JSON.stringify(renamed)}`).toEqual([]);
    });
});
