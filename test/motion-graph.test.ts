import { describe, expect, it } from 'vitest';
import { calculateMotionTime } from '../src/motion-graph';
import { prepareMotionGraph } from '../src/config';
import { createTestLogger } from './test-utils';
import type { MotionTimeGraph } from '../src/types';

function buildLinearGraph(upMs: number, downMs: number): MotionTimeGraph {
    const log = createTestLogger();
    return {
        up: prepareMotionGraph(
            [
                { pos: 0, seconds: 0 },
                { pos: 100, seconds: upMs / 1000 },
            ],
            'up',
            log,
        ),
        down: prepareMotionGraph(
            [
                { pos: 100, seconds: 0 },
                { pos: 0, seconds: downMs / 1000 },
            ],
            'down',
            log,
        ),
    };
}

describe('motion-graph', () => {
    it('returns 0 when start and end are equal', () => {
        const graph = buildLinearGraph(10000, 10000);
        expect(calculateMotionTime(graph, 50, 50, true)).toBe(0);
    });

    it('linear graph: half travel takes half the time', () => {
        const graph = buildLinearGraph(10000, 10000);
        expect(calculateMotionTime(graph, 0, 50, true)).toBeCloseTo(5000);
        expect(calculateMotionTime(graph, 100, 50, false)).toBeCloseTo(5000);
    });

    it('asymmetric up/down times honor direction', () => {
        const graph = buildLinearGraph(8000, 12000);
        expect(calculateMotionTime(graph, 0, 100, true)).toBeCloseTo(8000);
        expect(calculateMotionTime(graph, 100, 0, false)).toBeCloseTo(12000);
    });

    it('non-linear graph respects per-segment slope', () => {
        const log = createTestLogger();
        const graph: MotionTimeGraph = {
            up: prepareMotionGraph(
                [
                    { pos: 0, seconds: 0 },
                    { pos: 50, seconds: 2 },
                    { pos: 100, seconds: 10 },
                ],
                'up',
                log,
            ),
            down: prepareMotionGraph(
                [
                    { pos: 100, seconds: 0 },
                    { pos: 0, seconds: 10 },
                ],
                'down',
                log,
            ),
        };
        // 0 → 50: 2s. 50 → 75: half of (10-2)s = 4s. Total = 6s.
        expect(calculateMotionTime(graph, 0, 75, true)).toBeCloseTo(6000);
    });
});

describe('prepareMotionGraph', () => {
    it('rejects positions out of range', () => {
        const log = createTestLogger();
        const result = prepareMotionGraph(
            [
                { pos: -1, seconds: 0 },
                { pos: 0, seconds: 0 },
                { pos: 50, seconds: 5 },
                { pos: 100, seconds: 10 },
                { pos: 101, seconds: 11 },
            ],
            'up',
            log,
        );
        expect(result.map((s) => s.pos)).toEqual([0, 50, 100]);
        expect(log.lines.some((l) => l.message.includes('-1'))).toBe(true);
    });

    it('returns empty array when 0 or 100 missing', () => {
        const log = createTestLogger();
        const result = prepareMotionGraph(
            [
                { pos: 25, seconds: 1 },
                { pos: 75, seconds: 2 },
            ],
            'up',
            log,
        );
        expect(result).toEqual([]);
    });

    it('sorts unsorted input by position', () => {
        const log = createTestLogger();
        const result = prepareMotionGraph(
            [
                { pos: 100, seconds: 10 },
                { pos: 0, seconds: 0 },
                { pos: 50, seconds: 5 },
            ],
            'up',
            log,
        );
        expect(result.map((s) => s.pos)).toEqual([0, 50, 100]);
    });
});
