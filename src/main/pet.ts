import type { PetState } from '../shared/types';
import type { PetConfig } from './config';
import { Prey } from './prey';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** States the user can trigger from the menu or by voice. drag / fall are physics-only. */
export type CommandableState = Exclude<PetState, 'drag' | 'fall'>;

interface Press {
  start: Point;
  /** Cursor position relative to the window's top-left at press time. */
  offset: Point;
  at: number;
}

const clamp = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max);

/**
 * Pet behaviour: position, state transitions, animation frame.
 * Pure logic with no Electron dependency. All coordinates are screen DIP;
 * (x, y) is the top-left corner of the pet's window.
 */
export class Pet {
  x: number;
  y: number;
  state: PetState = 'fall';
  facing: 1 | -1 = 1;
  frame = 0;
  /** The mouse being hunted, or one still running off after a hunt. null = no mouse on screen. */
  prey: Prey | null = null;

  private vx = 0;
  private vy = 0;
  /** Take-off speed of the current jump, px/s. */
  private launchSpeed = 0;
  private airborne = false;
  /** The current jump is a pounce at the prey, not a jump on command. */
  private pouncing = false;
  private huntMs = 0;
  private clock = 0;
  private stateMs = 0;
  private stateLimitMs = Number.POSITIVE_INFINITY;
  private loopsLeft = 0;
  private frameMs = 0;
  private press: Press | null = null;

  constructor(
    private readonly cfg: PetConfig,
    private readonly frameCounts: Readonly<Record<PetState, number>>,
    spawn: Point,
    private readonly rng: () => number = Math.random,
  ) {
    this.x = spawn.x;
    this.y = spawn.y;
  }

  /** True from mouse-down to mouse-up on the pet (click or drag). */
  get pointerHeld(): boolean {
    return this.press !== null;
  }

  pointerDown(cursor: Point): void {
    this.press = {
      start: { ...cursor },
      offset: { x: cursor.x - this.x, y: cursor.y - this.y },
      at: this.clock,
    };
  }

  /** @returns true if the gesture was a drag, i.e. the pet may now be on another display. */
  pointerUp(): boolean {
    if (!this.press) return false;
    this.press = null;
    if (this.state === 'drag') {
      this.vy = 0;
      this.enter('fall');
      return true;
    }
    this.poke();
    return false;
  }

  /** Reaction to a click: wake up if asleep, otherwise play a trick. */
  poke(): void {
    if (this.state === 'fall' || this.state === 'jump') return;
    if (this.state === 'sleep') this.enter('idle');
    else this.enter(this.rng() < 0.5 ? 'roll' : 'chase');
  }

  command(state: CommandableState): void {
    // Airborne states end on their own; switching mid-air would snap the pet to the floor.
    if (this.state === 'drag' || this.state === 'fall' || this.state === 'jump') return;
    this.enter(state);
  }

  /**
   * Advance the simulation.
   * @param dtMs   elapsed time since the previous call
   * @param area   work area of the display the pet lives on
   * @param cursor current cursor position
   */
  update(dtMs: number, area: Rect, cursor: Point): void {
    this.clock += dtMs;
    const dt = dtMs / 1000;
    const { size } = this.cfg;
    const minX = area.x;
    const maxX = Math.max(minX, area.x + area.width - size);
    const floor = area.y + area.height - size;

    // A press becomes a drag once it moves far enough or is held long enough.
    if (this.press && this.state !== 'drag') {
      const moved = Math.hypot(cursor.x - this.press.start.x, cursor.y - this.press.start.y);
      const heldMs = this.clock - this.press.at;
      if (moved > this.cfg.clickMaxPx || heldMs > this.cfg.clickMaxMs) this.enter('drag');
    }

    switch (this.state) {
      case 'drag':
        // Not clamped: the pet can be carried to another display.
        if (this.press) {
          this.x = cursor.x - this.press.offset.x;
          this.y = cursor.y - this.press.offset.y;
        }
        break;

      case 'fall':
        this.vy += this.cfg.gravity * dt;
        this.y += this.vy * dt;
        this.x = clamp(this.x, minX, maxX);
        if (this.y >= floor) {
          this.y = floor;
          this.vy = 0;
          this.enter('idle');
        }
        break;

      case 'walk':
        this.x += this.facing * this.cfg.walkSpeed * dt;
        if (this.x <= minX) {
          this.x = minX;
          this.facing = 1;
        } else if (this.x >= maxX) {
          this.x = maxX;
          this.facing = -1;
        }
        this.y = floor;
        break;

      case 'run': {
        if (this.cfg.runMode === 'wheel') {
          // Running in place in the wheel: no mouse, no travel. Ends after the time set in enter().
          this.x = clamp(this.x, minX, maxX);
          this.y = floor;
          if (this.stateMs >= this.stateLimitMs) this.enter('idle');
          break;
        }
        const { hunt } = this.cfg;
        const center = this.x + size / 2;
        this.prey ??= new Prey(hunt, area, center, this.rng);
        this.huntMs += dtMs;
        this.y = floor;
        if (this.huntMs >= hunt.timeoutMs) {
          this.enter('sit'); // gives up; enter() sends the mouse off screen
          break;
        }
        const gap = this.prey.centerX - center;
        this.facing = gap >= 0 ? 1 : -1;
        if (Math.abs(gap) <= hunt.pounceRange) {
          this.pouncing = true;
          this.enter('jump');
          break;
        }
        this.x = clamp(this.x + this.facing * hunt.runSpeed * dt, minX, maxX);
        break;
      }

      case 'jump':
        if (!this.airborne) {
          // Crouch on the floor first, then take off.
          this.x = clamp(this.x, minX, maxX);
          this.y = floor;
          if (this.stateMs >= this.cfg.jump.crouchMs) this.launch();
          break;
        }
        this.vy += this.cfg.gravity * dt;
        this.y += this.vy * dt;
        this.x = clamp(this.x + this.vx * dt, minX, maxX);
        if (this.y >= floor) {
          this.y = floor;
          this.land();
        }
        break;

      default:
        // Grounded states. Re-pinned every tick so a work-area change (taskbar, resolution) self-heals.
        this.x = clamp(this.x, minX, maxX);
        this.y = floor;
    }

    if (this.prey && !this.prey.update(dtMs, area, this.x + size / 2)) {
      this.prey = null;
      if (this.state === 'run') this.enter('sit'); // it got away
    }

    this.animate(dtMs);
  }

  private launch(): void {
    const { size, gravity, jump, hunt } = this.cfg;
    this.launchSpeed = Math.sqrt(2 * gravity * (this.pouncing ? hunt.pounceHeight : jump.height));
    this.vy = -this.launchSpeed;
    this.airborne = true;

    const prey = this.pouncing ? this.prey : null;
    if (!prey) {
      this.vx = this.facing * jump.hopSpeed;
      return;
    }
    // Aim for where the mouse will be when the cat comes down.
    const flightS = (2 * this.launchSpeed) / gravity;
    const reach = prey.centerX + prey.vx * flightS - (this.x + size / 2);
    this.vx = clamp(reach / flightS, -hunt.pounceMaxSpeed, hunt.pounceMaxSpeed);
    if (reach !== 0) this.facing = reach > 0 ? 1 : -1;
  }

  private land(): void {
    this.vy = 0;
    if (!this.pouncing) {
      this.enter('idle');
      return;
    }
    const { size, hunt } = this.cfg;
    const prey = this.prey;
    if (!prey) {
      this.enter('sit'); // the mouse left the screen mid-pounce
    } else if (Math.abs(prey.centerX - (this.x + size / 2)) <= hunt.catchRadius) {
      this.prey = null;
      this.enter('roll'); // caught it
    } else {
      this.enter('run');
    }
  }

  private animate(dtMs: number): void {
    const rule = this.cfg.states[this.state];
    const count = Math.max(1, this.frameCounts[this.state]);

    if (this.state === 'jump') {
      // Frame 0 is the crouch; the others are spread over the arc, from take-off to touchdown.
      const arc =
        this.launchSpeed > 0 ? clamp((this.vy + this.launchSpeed) / (2 * this.launchSpeed), 0, 1) : 0;
      this.frame = this.airborne ? Math.min(count - 1, 1 + Math.floor(arc * (count - 1))) : 0;
      this.stateMs += dtMs;
      return;
    }

    const frameMs = 1000 / rule.fps;

    this.frameMs += dtMs;
    while (this.frameMs >= frameMs) {
      this.frameMs -= frameMs;
      this.frame += 1;
      if (this.frame >= count) {
        this.frame = 0;
        if (rule.kind === 'oneshot') {
          this.loopsLeft -= 1;
          if (this.loopsLeft <= 0) {
            this.enter('idle');
            return;
          }
        }
      }
    }

    this.stateMs += dtMs;
    if (rule.kind === 'timed' && this.stateMs >= this.stateLimitMs) {
      this.enter(this.state === 'idle' ? this.pickNext() : 'idle');
    }
  }

  private enter(next: PetState): void {
    // A hunt spans 'run' and the pounces ('jump') in between; any other state ends it.
    if (next === 'run') {
      if (!this.pouncing) {
        this.huntMs = 0;
        this.prey?.lure();
      }
    } else if (!(next === 'jump' && this.pouncing)) {
      this.prey?.escape();
    }
    if (next !== 'jump') this.pouncing = false;
    this.airborne = false;

    const rule = this.cfg.states[next];
    this.state = next;
    this.frame = 0;
    this.frameMs = 0;
    this.stateMs = 0;
    this.stateLimitMs =
      rule.kind === 'timed'
        ? rule.minMs + (rule.maxMs - rule.minMs) * this.rng()
        : Number.POSITIVE_INFINITY;
    this.loopsLeft = rule.kind === 'oneshot' ? rule.loops : 0;
    if (next === 'run' && this.cfg.runMode === 'wheel') {
      const { minMs, maxMs } = this.cfg.wheel;
      this.stateLimitMs = minMs + (maxMs - minMs) * this.rng();
    }
    if (next === 'walk') this.facing = this.rng() < 0.5 ? 1 : -1;
  }

  /** Running in its wheel (the `run` state of a pet whose runMode is 'wheel'). */
  get inWheel(): boolean {
    return this.state === 'run' && this.cfg.runMode === 'wheel';
  }

  private pickNext(): PetState {
    const total = this.cfg.idleNext.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = this.rng() * total;
    for (const [state, weight] of this.cfg.idleNext) {
      roll -= weight;
      if (roll < 0) return state;
    }
    return 'idle';
  }
}
