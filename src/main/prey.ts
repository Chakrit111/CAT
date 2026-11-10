import type { HuntConfig } from './config';
import type { Rect } from './pet';

/**
 * wander: has not noticed the cat. flee: running from it.
 * escape: the hunt is over and it is leaving by the nearest screen edge.
 */
export type PreyMode = 'wander' | 'flee' | 'escape';

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

  private readonly fleeSpeed: number;
  private pauseMs = 0;
  private decideMs: number;

  constructor(
    private readonly cfg: HuntConfig,
    area: Rect,
    catCenterX: number,
    private readonly rng: () => number = Math.random,
  ) {
    // Peeks in from whichever screen edge is farther from the cat.
    const fromLeft = catCenterX > area.x + area.width / 2;
    this.x = fromLeft ? area.x - cfg.mouseSize + 1 : area.x + area.width - 1;
    this.y = area.y + area.height - cfg.mouseSize;
    this.facing = fromLeft ? 1 : -1;
    this.fleeSpeed = cfg.fleeSpeedMin + (cfg.fleeSpeedMax - cfg.fleeSpeedMin) * rng();
    this.decideMs = this.nextDecision();
  }

  get centerX(): number {
    return this.x + this.cfg.mouseSize / 2;
  }

  /** Signed horizontal speed, px/s. */
  get vx(): number {
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
    const { mouseSize, alertRange } = this.cfg;
    const gap = Math.abs(catCenterX - this.centerX);
    this.y = area.y + area.height - mouseSize;

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
        if (this.x <= area.x) this.facing = 1;
        else if (this.x >= area.x + area.width - mouseSize) this.facing = -1;
        break;
    }

    this.x += this.vx * (dtMs / 1000);
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
