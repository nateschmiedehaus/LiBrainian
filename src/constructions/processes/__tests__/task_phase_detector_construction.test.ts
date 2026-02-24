import { describe, expect, it } from 'vitest';
import {
  AgentPhase,
  buildPhaseProactiveIntel,
  createTaskPhaseDetectorConstruction,
  detectTaskPhase,
} from '../task_phase_detector_construction.js';

describe('TaskPhaseDetectorConstruction', () => {
  it('classifies each lifecycle phase from deterministic signal patterns', async () => {
    const construction = createTaskPhaseDetectorConstruction();

    const orient = await construction.execute({
      intent: 'understand auth module entrypoints',
      recentToolCalls: [],
      affectedFiles: ['src/auth/session.ts'],
    });
    expect(orient.ok).toBe(true);
    if (!orient.ok) throw orient.error;
    expect(orient.value.detection.phase).toBe(AgentPhase.Orient);

    const plan = await construction.execute({
      intent: 'plan refactor scope for auth',
      recentToolCalls: ['get_change_impact'],
      affectedFiles: ['src/auth/session.ts'],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw plan.error;
    expect(plan.value.detection.phase).toBe(AgentPhase.Plan);

    const implement = await construction.execute({
      intent: 'implement token refresh fix',
      recentToolCalls: ['write_file'],
      affectedFiles: ['src/auth/session.ts'],
    });
    expect(implement.ok).toBe(true);
    if (!implement.ok) throw implement.error;
    expect(implement.value.detection.phase).toBe(AgentPhase.Implement);

    const verify = await construction.execute({
      intent: 'verify tests and pre-commit checklist',
      recentToolCalls: ['run_audit'],
      affectedFiles: ['src/auth/session.ts'],
    });
    expect(verify.ok).toBe(true);
    if (!verify.ok) throw verify.error;
    expect(verify.value.detection.phase).toBe(AgentPhase.Verify);

    const reflect = await construction.execute({
      intent: 'capture outcome and feedback from this task',
      recentToolCalls: ['submit_feedback'],
      affectedFiles: ['src/auth/session.ts'],
    });
    expect(reflect.ok).toBe(true);
    if (!reflect.ok) throw reflect.error;
    expect(reflect.value.detection.phase).toBe(AgentPhase.Reflect);
  });

  it('tracks phase transitions with confidence and signal attribution', () => {
    const result = detectTaskPhase({
      intent: 'verify rollout checklist',
      recentToolCalls: ['pre_commit_check'],
      previousPhase: AgentPhase.Implement,
      affectedFiles: ['src/auth/session.ts'],
    });
    expect(result.detection.phase).toBe(AgentPhase.Verify);
    expect(result.detection.transitionedFrom).toBe(AgentPhase.Implement);
    expect(result.detection.confidence).toBeGreaterThan(0.6);
    expect(result.detection.signals.length).toBeGreaterThan(0);
  });

  it('produces different proactive intel for orient vs implement on same file scope', () => {
    const files = ['src/auth/session.ts'];
    const orientIntel = buildPhaseProactiveIntel(AgentPhase.Orient, files);
    const implementIntel = buildPhaseProactiveIntel(AgentPhase.Implement, files);
    expect(orientIntel[0]?.type).toBe('ambient-briefing');
    expect(implementIntel[0]?.type).toBe('convention-alert');
    expect(orientIntel[0]?.content).not.toBe(implementIntel[0]?.content);
  });

  it('falls back to unknown for empty signal input without crashing', () => {
    const result = detectTaskPhase({
      intent: '',
      recentToolCalls: [],
      affectedFiles: [],
    });
    expect(result.detection.phase).toBe(AgentPhase.Unknown);
    expect(result.proactiveIntel).toHaveLength(0);
  });
});

