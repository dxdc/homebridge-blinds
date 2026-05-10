import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Tiny synchronous JSON-file store. Files are written as `<dir>/<key>`
 * containing `{"key":<key>,"value":<value>}`.
 */
export class Storage {
    constructor(private readonly dir: string) {
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
    }

    /** Returns `undefined` for missing or corrupt files. */
    getItemSync<T = unknown>(key: string): T | undefined {
        const path = join(this.dir, sanitizeKey(key));
        if (!existsSync(path)) return undefined;
        try {
            const raw = readFileSync(path, 'utf8');
            const parsed = JSON.parse(raw) as { value?: T };
            return parsed.value;
        } catch {
            return undefined;
        }
    }

    setItemSync(key: string, value: unknown): void {
        const path = join(this.dir, sanitizeKey(key));
        writeFileSync(path, JSON.stringify({ key, value }), 'utf8');
    }
}

/** Prevent a malformed accessory name from escaping the storage directory. */
function sanitizeKey(key: string): string {
    return key.replace(/[\\/]/g, '_');
}
