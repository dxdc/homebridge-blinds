import type { MotionTimeGraph } from './types';

const MS_PER_SECOND = 1000;

/** Expected motion time in ms between two positions on the per-direction graph. */
export function calculateMotionTime(graph: MotionTimeGraph, startPos: number, endPos: number, moveUp: boolean): number {
    if (startPos === endPos) return 0;

    const steps = moveUp ? graph.up : graph.down;
    if (!steps || steps.length === 0) return 0;

    // Both directions iterate ascending; standardize current/target so the
    // segment math is direction-agnostic.
    let current = moveUp ? startPos : endPos;
    const target = moveUp ? endPos : startPos;

    let total = 0;
    for (const step of steps) {
        if (!step.motionTimeStep || current === target || step.pos <= current) continue;
        const stepTarget = Math.min(step.pos, target);
        total += (stepTarget - current) * step.motionTimeStep * MS_PER_SECOND;
        current = stepTarget;
    }
    return total;
}
