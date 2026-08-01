/**
 * Provenance vocabulary for SimParams knobs (AGENTS.md §5 and DO-NOT rule 1).
 *
 * Every default in the params.<block>.ts modules carries one tag in its
 * block's `<block>Provenance` map; sim/params.ts composes those maps into
 * `paramProvenance`, and test/params-provenance.test.ts asserts every knob
 * on the surface is tagged. The tag records where the CURRENT default value
 * came from:
 *
 *   REAL  — pinned by a real-world quantity or fitted against measured
 *           real-corpus targets (league rates, rule seconds/distances,
 *           corpus CDFs, the ffit-* corpus/gate fits).
 *   SWEPT — chosen by the calibration sweep's optimizer against the
 *           acceptance bands. The odd precision is the point: never tidy a
 *           SWEPT value (AGENTS.md §2.1) — re-run the sweep and bake its
 *           output instead.
 *   FEEL  — hand-set design judgment (plausible motion/timing, EV shapes,
 *           stage switches), including probe-verified hand-chosen values.
 *
 * Adjudication at the #36 split, where prose and metadata could disagree:
 * a knob's own comment tag wins (the final era for history chains); a group
 * comment covers its members; values fitted against real-corpus targets are
 * REAL (the file's existing convention); a harness/src/knobs.ts-registered
 * knob whose current value carries optimizer-grade precision is SWEPT even
 * where an older comment still says FEEL — the comment records the seed's
 * origin, the map records the shipped value's.
 */

/** where a SimParams default came from — see the module header for meanings */
export type Provenance = 'REAL' | 'SWEPT' | 'FEEL';
