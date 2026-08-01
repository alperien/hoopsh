/**
 * The engine/booth dunk-gate mirror (session-8 arc, verifier F12): the
 * engine's leak-out designation gates on ai.dunkAthleteGate with the
 * dunkBlendVert/dunkBlendFin blend, mirroring this package's
 * DUNK_ATHLETE_SCORE and its 0.6/0.4 blend — the booth's definition of who
 * dunks IS the engine's definition of who leaks. The engine imports
 * nothing, so the pair is pinned here, from the outside, at the one place
 * allowed to see both. If either side moves alone this fails and the fix
 * is to move BOTH (or to deliberately decouple with a register row).
 *
 * #86 extended the contract to the putback branch: the engine's strong
 * putback (possession.ts putbackResolvesStrong — the same gate params
 * through ai/offense.ts clearsDunkGate) resolves at the rim plane, and
 * the booth books that make as the putback DUNK with the tip-in
 * outranked. The second case below pins the putback branch of the pair.
 * The reorder cases after it (#86 round 2) pin the booking ORDER across
 * the tip-in window, where the order is live at every knob value.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams } from '@hoopsh/engine';
import { shotCall } from '../src/shotcall.js';

describe('the dunk-gate mirror (params.ai <-> shotcall)', () => {
  it('gate and blend weights match the booth', () => {
    const A = defaultParams.ai;
    // shotcall's constants are module-private by design; probe the boundary
    // behaviorally: a made point-blank finish by a shooter exactly AT the
    // engine gate must call 'dunk', and one just under must not.
    const shot = { zone: 'rim' as const, distFt: 1.5, moveType: 'cut_finish' as const, three: false, made: true };
    const at = { vertical: A.dunkAthleteGate, finishing: A.dunkAthleteGate };
    const under = { vertical: A.dunkAthleteGate - 2, finishing: A.dunkAthleteGate - 2 };
    expect(shotCall(shot, at)).toBe('dunk');
    expect(shotCall(shot, under)).not.toBe('dunk');
    // the blend weights the engine uses must be the booth's 0.6/0.4: a
    // vertical-heavy body that clears ONLY under 0.6/0.4 must call dunk
    const vertHeavy = { vertical: A.dunkAthleteGate + 10, finishing: A.dunkAthleteGate - 14 };
    const blend = A.dunkBlendVert * vertHeavy.vertical + A.dunkBlendFin * vertHeavy.finishing;
    expect(blend).toBeGreaterThanOrEqual(A.dunkAthleteGate); // engine says yes
    expect(shotCall(shot, vertHeavy)).toBe('dunk');  // booth agrees
  });

  it('the putback branch of the mirror (#86): the slam outranks the tip-in', () => {
    const A = defaultParams.ai;
    // the engine's strong class (possession.ts putbackResolvesStrong:
    // gate-clearing rebounder in the restricted area) releases at the rim
    // plane — distFt 0 by construction. The booth must book that make as
    // the putback DUNK; the same gate params decide both sides, so every
    // engine-strong make books dunk. ONE-DIRECTIONAL (#86 round 2): the
    // booth's putback-dunk set is strictly larger at every knob value —
    // the reorder cases below pin that side.
    const pb = { zone: 'rim' as const, distFt: 0, moveType: 'putback' as const, three: false, made: true };
    const at = { vertical: A.dunkAthleteGate, finishing: A.dunkAthleteGate };
    const under = { vertical: A.dunkAthleteGate - 2, finishing: A.dunkAthleteGate - 2 };
    expect(shotCall(pb, at)).toBe('dunk');
    // under the gate the point-blank tap keeps its tip-in
    expect(shotCall(pb, under)).toBe('tip-in');
    // made-gated as everywhere: a missed point-blank putback never dunks
    expect(shotCall({ ...pb, made: false }, at)).toBe('tip-in');
    // and a traitless call stays conservative (tip, never dunk)
    expect(shotCall(pb)).toBe('tip-in');
  });

  // #86 round 2 (PR #91, Red Team finding 2): the dunk-before-tip-in order
  // in shotcall.ts reads no knob — it books at every dose, including the
  // staged zero — and the putback branch above pins only the strong
  // signature (distFt 0). These three cases pin the ORDER itself across
  // the tip-in window and up to the dunk ceiling, where the ~0.2/g
  // booking relabel actually lives.
  it('the reorder pin (#86 round 2): a gate-clearing putback make at 1.0 ft books the dunk', () => {
    const A = defaultParams.ai;
    // inside the tip-in window: the old booth (tip-in checked first)
    // called this a tip-in; the slam outranks it now. Reverting the
    // order flips exactly this case red.
    const pb = { zone: 'rim' as const, distFt: 1.0, moveType: 'putback' as const, three: false, made: true };
    const at = { vertical: A.dunkAthleteGate, finishing: A.dunkAthleteGate };
    expect(shotCall(pb, at)).toBe('dunk');
  });

  it('the reorder pin (#86 round 2): the same make at 2.0 ft books the dunk', () => {
    const A = defaultParams.ai;
    // above the tip-in ceiling, inside the dunk ceiling: dunk under
    // either order (the pre-existing window). This pin holds the window
    // edges so neither ceiling drifts silently.
    const pb = { zone: 'rim' as const, distFt: 2.0, moveType: 'putback' as const, three: false, made: true };
    const at = { vertical: A.dunkAthleteGate, finishing: A.dunkAthleteGate };
    expect(shotCall(pb, at)).toBe('dunk');
  });

  it('the reorder pin (#86 round 2): an under-gate putback make at 1.0 ft keeps its tip-in', () => {
    const A = defaultParams.ai;
    // the reorder must never widen the dunk set: without the springs the
    // window tap stays a tip-in at every dose, under either order.
    const pb = { zone: 'rim' as const, distFt: 1.0, moveType: 'putback' as const, three: false, made: true };
    const under = { vertical: A.dunkAthleteGate - 2, finishing: A.dunkAthleteGate - 2 };
    expect(shotCall(pb, under)).toBe('tip-in');
  });
});
