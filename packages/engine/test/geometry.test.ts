import { describe, expect, it } from 'vitest';
import { NBA, makeCourt, classifyShot } from '@hoopsh/engine';

describe('court geometry & three-point classification (NBA pack)', () => {
  const court = makeCourt(NBA);
  const rim = court.rims[0]; // (5.25, 25)

  it('above-the-break three at 24 ft', () => {
    const p = { x: rim.x + 24, y: 25 };
    const loc = classifyShot(NBA, court, rim, p);
    expect(loc.three).toBe(true);
    expect(loc.zone).toBe('three');
  });

  it('23-footer straight on is a long two', () => {
    const p = { x: rim.x + 23, y: 25 };
    const loc = classifyShot(NBA, court, rim, p);
    expect(loc.three).toBe(false);
    expect(loc.zone).toBe('mid');
  });

  it('corner three: 22.5 ft lateral in the corner', () => {
    const p = { x: 8, y: 25 - 22.5 }; // 8ft from baseline, near sideline
    const loc = classifyShot(NBA, court, rim, p);
    expect(loc.three).toBe(true);
  });

  it('corner-distance shot above the break is NOT a three', () => {
    // 22 ft from rim but past the corner-break region and inside the 23.75 arc
    const p = { x: rim.x + 22, y: 25 };
    const loc = classifyShot(NBA, court, rim, p);
    expect(loc.three).toBe(false);
  });

  it('rim and paint zones classify by distance', () => {
    expect(classifyShot(NBA, court, rim, { x: rim.x + 2, y: 25 }).zone).toBe('rim');
    expect(classifyShot(NBA, court, rim, { x: rim.x + 9, y: 25 }).zone).toBe('paint');
    expect(classifyShot(NBA, court, rim, { x: rim.x + 17, y: 25 }).zone).toBe('mid');
  });
});
