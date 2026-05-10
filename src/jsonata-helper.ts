import jsonata from 'jsonata';
import type { Logger } from './types';

/** Compiled JSONata expression that logs and returns `null` on parse error. */
export class JsonataExpression {
    private constructor(private readonly expr: ReturnType<typeof jsonata>) {}

    static compile(expression: string | false, label: string, log: Logger): JsonataExpression | null {
        if (!expression) return null;
        try {
            return new JsonataExpression(jsonata(expression));
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log.error(`Error parsing ${label}: ${message}`);
            return null;
        }
    }

    async evaluate(input: unknown): Promise<unknown> {
        return this.expr.evaluate(input);
    }
}
