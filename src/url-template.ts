import type { HttpEndpoint } from './types';

/**
 * URL/body placeholders:
 *   - `%%POS%%`       inserts the position literally (stays inside JSON quotes).
 *   - `"%%POSINT%%"`  the quoted form is replaced as a raw JSON number,
 *                     dropping the surrounding quotes (e.g. `"position": 42`).
 */
const PLACEHOLDER_RE = /%%POS%%|"%%POSINT%%"/g;

/**
 * `null` → no placeholder present (caller still needs a stop command).
 * `HttpEndpoint` → templated request that drives the blind to the exact target.
 */
export type TemplateResult = HttpEndpoint | null;

/** Returns a new endpoint with placeholders replaced; input is not mutated. */
export function applyPositionTemplate(endpoint: HttpEndpoint, pos: number): TemplateResult {
    const replace = (s: string): { value: string; replaced: boolean } => {
        // Fresh regex per call so the `g` flag's `lastIndex` doesn't leak.
        const re = new RegExp(PLACEHOLDER_RE.source, 'g');
        if (!re.test(s)) return { value: s, replaced: false };
        return { value: s.replace(new RegExp(PLACEHOLDER_RE.source, 'g'), String(pos)), replaced: true };
    };

    const next: HttpEndpoint = { ...endpoint };
    let anyReplaced = false;

    if (typeof endpoint.url === 'string') {
        const r = replace(endpoint.url);
        next.url = r.value;
        anyReplaced ||= r.replaced;
    }

    if (endpoint.body !== undefined) {
        if (typeof endpoint.body === 'string') {
            const r = replace(endpoint.body);
            next.body = r.value;
            anyReplaced ||= r.replaced;
        } else {
            const serialized = JSON.stringify(endpoint.body);
            const r = replace(serialized);
            if (r.replaced) {
                try {
                    next.body = JSON.parse(r.value) as Record<string, unknown>;
                } catch {
                    next.body = r.value;
                }
                anyReplaced = true;
            }
        }
    }

    return anyReplaced ? next : null;
}
