import type { HuntConfig } from './config';
import type { Rect } from './pet';

/**
 * wander: has not noticed the cat. flee: running from it.
 * escape: the hunt is over and it is leaving by the nearest screen edge.
 */
export type PreyMode = 'wander' | 'flee' | 'escape';

/** A mouse that stands for a Claude session: it stays on screen until it is caught or told to leave. */
export interface PennedOptions {
  /** It keeps this far from the screen edges, so the cat can always land on it. */
  margin: number;
  /** Its speed when it flees, px/s: slower than the cat. */
  fleeSpeed: number;
}

/**
 * The mouse the cat hunts. Pure logic, like Pet: screen DIP, (x, y) is the top-left corner of its window.
 */
export class Prey {
  x: number;
  y: number;
  facing: 1 | -1;
  mode: PreyMode = 'wander';
  /** false while it pauses to sniff around. */
  moving = true;
  /** Set from outside: it stands where it is (its session waits for the user) until it flees or leaves. */
  frozen = false;

  private readonly fleeSpeed: number;
  /** A penned mouse ran into the edge of its pen on the last update: it is going nowhere. */
  private cornered = false;
  private pauseMs = 0;
  private decideMs: number;

  constructor(
    private readonly cfg: HuntConfig,
    area: Rect,
    catCenterX: number,
    private readonly rng: () => number = Math.random,
    /** Set for a session's mouse; a mouse of the hunt game runs off the screen when chased. */
    private readonly pen?: PennedOptions,
  ) {
    // Peeks in from whichever screen edge is farther from the cat.
    const fromLeft = catCenterX > area.x + area.width / 2;
    this.x = fromLeft ? area.x - cfg.mouseSize + 1 : area.x + area.width - 1;
    this.y = area.y + area.height - cfg.mouseSize;
    this.facing = fromLeft ? 1 : -1;
    this.fleeSpeed = pen?.fleeSpeed ?? cfg.fleeSpeedMin + (cfg.fleeSpeedMax - cfg.fleeSpeedMin) * rng();
    this.decideMs = this.nextDecision();
  }

  get centerX(): number {
    return this.x + this.cfg.mouseSize / 2;
  }

  /** Signed horizontal speed, px/s. What the cat aims its pounce by. */
  get vx(): number {
    return this.cornered ? 0 : this.velocity();
  }

  private velocity(): number {
    if (!this.moving) return 0;
    const { wanderSpeed, escapeSpeed } = this.cfg;
    const speed =
      this.mode === 'flee' ? this.fleeSpeed : this.mode === 'escape' ? escapeSpeed : wanderSpeed;
    return this.facing * speed;
  }

  /** The cat lost interest: leave the screen. */
  escape(): void {
    this.mode = 'escape';
  }

  /** The cat is hunting again: a mouse on its way out is back in play. */
  lure(): void {
    if (this.mode === 'escape') this.mode = 'wander';
  }

  /** @returns false once the mouse has left the screen. */
  update(dtMs: number, area: Rect, catCenterX: number): boolean {
    const { mouseSize, alertRange, wanderSpeed } = this.cfg;
    const gap = Math.abs(catCenterX - this.centerX);
    this.y = area.y + area.height - mouseSize;
    this.cornered = false;

    // The stretch of floor it lives on: the whole screen, or its pen.
    const margin = this.pen?.margin ?? 0;
    const lo = area.x + margin;
    const hi = Math.max(lo, area.x + area.width - mouseSize - margin);

    if (this.pen && this.mode !== 'escape') {
      if (this.x < lo || this.x > hi) {
        // Still on its way in (or the screen changed under it): walk into the pen first.
        this.facing = this.x < lo ? 1 : -1;
        this.moving = true;
        this.x += this.facing * wanderSpeed * (dtMs / 1000);
        return true;
      }
      if (this.frozen && this.mode === 'wander' && gap >= alertRange) {
        this.moving = false;
        return true;
      }
    }

    if (this.mode === 'wander' && gap < alertRange) this.mode = 'flee';
    else if (this.mode === 'flee' && gap > alertRange * 2) this.mode = 'wander';

    switch (this.mode) {
      case 'flee':
        this.moving = true;
        this.facing = this.centerX >= catCenterX ? 1 : -1;
        break;
      case 'escape':
        this.moving = true;
        this.facing = this.centerX < area.x + area.width / 2 ? -1 : 1;
        break;
      case 'wander':
        this.wander(dtMs);
        // Stays on screen until something spooks it.
        if (this.x <= lo) this.facing = 1;
        else if (this.x >= hi) this.facing = -1;
        break;
    }

    this.x += this.velocity() * (dtMs / 1000);
    if (this.pen && this.mode === 'flee' && (this.x < lo || this.x > hi)) {
      this.x = Math.min(Math.max(this.x, lo), hi);
      this.cornered = true;
    }
    return (
      this.mode === 'wander' || (this.x + mouseSize > area.x && this.x < area.x + area.width)
    );
  }

  private wander(dtMs: number): void {
    if (this.pauseMs > 0) {
      this.pauseMs -= dtMs;
      this.moving = this.pauseMs <= 0;
      return;
    }
    this.moving = true;
    this.decideMs -= dtMs;
    if (this.decideMs > 0) return;

    this.decideMs = this.nextDecision();
    const roll = this.rng();
    if (roll < 0.35) this.pauseMs = 300 + 600 * this.rng();
    else if (roll < 0.55) this.facing = this.facing === 1 ? -1 : 1;
  }

  private nextDecision(): number {
    return 1_200 + 2_300 * this.rng();
  }
}
