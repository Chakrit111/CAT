import type { PetState } from '../shared/types';

export type StateRule =
  /** Loops until a random timer in [minMs, maxMs] expires. */
  | { kind: 'timed'; fps: number; minMs: number; maxMs: number }
  /** Plays the animation `loops` times, then returns to idle. */
  | { kind: 'oneshot'; fps: number; loops: number }
  /** Ended by physics or user input, never by a timer. */
  | { kind: 'manual'; fps: number };

export interface JumpConfig {
  /** Apex height of a jump on command, px. */
  height: number;
  /** Forward drift while airborne, px/s. */
  hopSpeed: number;
  /** Time spent crouching on the floor before take-off. */
  crouchMs: number;
}

export interface HuntConfig {
  /** Mouse window edge length in DIP. */
  mouseSize: number;
  /** Cat speed while chasing, px/s. */
  runSpeed: number;
  /** Mouse speed before it notices the cat, px/s. */
  wanderSpeed: number;
  /** Each mouse flees at a random speed in this range, px/s. The nearer to runSpeed, the likelier it gets away. */
  fleeSpeedMin: number;
  fleeSpeedMax: number;
  /** Speed of a mouse leaving the screen once the hunt is called off, px/s. */
  escapeSpeed: number;
  /** The mouse bolts when the cat comes closer than this (px between centres). */
  alertRange: number;
  /** The cat pounces when it is closer than this. */
  pounceRange: number;
  /** Apex height of a pounce, px. */
  pounceHeight: number;
  /** Cap on the horizontal speed of a pounce, px/s. */
  pounceMaxSpeed: number;
  /** A pounce that lands within this distance of the mouse catches it. */
  catchRadius: number;
  /** The cat gives up after running for this long. */
  timeoutMs: number;
}

export interface VoiceConfig {
  /** Hugging Face id of an ONNX Whisper model. Downloaded on first run, then cached. */
  model: string;
  /** Whisper language code of the pack's voice phrases, e.g. 'th' (pet.json `voice.language`). */
  language: string;
  /** How long a right-click listens before falling back to the menu. */
  maxMs: number;
  /**
   * Lowest score at which a command is carried out; below it the menu opens instead.
   * A score is the average log-probability per token of the best phrase (0 = certain), and
   * every attempt's score is logged as `[voice] ...`. In test recordings commands scored
   * -0.3 to -1.8 and other speech -2.1 or lower. Lower accepts mumbled commands, and more
   * speech that was never a command.
   */
  minScore: number;
}

export interface SoundConfig {
  /** 0..1 */
  volume: number;
  /** Purring starts this long after the cat falls asleep, so it never cuts off a meow. */
  purrDelayMs: number;
  /** Now and then the cat makes a sound on its own; the gap between two is random in [min, max]. */
  chatterMs: { min: number; max: number };
}

export interface PetConfig {
  sounds: SoundConfig;
  /** Window edge length in DIP. Sprites are scaled to this square. */
  size: number;
  /** Horizontal walk speed, px/s. */
  walkSpeed: number;
  /** Fall acceleration, px/s^2. */
  gravity: number;
  /** A press shorter than this AND moving less than clickMaxPx is a click, not a drag. */
  clickMaxMs: number;
  clickMaxPx: number;
  /** Pixels with alpha above this (0-255) are clickable; the rest is click-through. */
  alphaThreshold: number;
  states: Record<PetState, StateRule>;
  /** Weighted choice of what to do when the idle timer expires. */
  idleNext: ReadonlyArray<readonly [PetState, number]>;
  jump: JumpConfig;
  hunt: HuntConfig;
  voice: VoiceConfig;
}

/**
 * The engine's defaults. A pet pack overrides any of them in the `tuning` section of its
 * pet.json (see pack.ts); sprites, sounds and the icon come from the pack's folder.
 */
export const DEFAULT_CONFIG: PetConfig = {
  sounds: {
    volume: 0.6,
    purrDelayMs: 1_500,
    chatterMs: { min: 4 * 60_000, max: 6 * 60_000 }, // about every 5 minutes
  },
  size: 160,
  walkSpeed: 70,
  gravity: 2400,
  clickMaxMs: 250,
  clickMaxPx: 4,
  alphaThreshold: 32,
  states: {
    idle: { kind: 'timed', fps: 5, minMs: 2_000, maxMs: 5_000 },
    walk: { kind: 'timed', fps: 10, minMs: 3_000, maxMs: 8_000 },
    sit: { kind: 'timed', fps: 2, minMs: 3_000, maxMs: 7_000 },
    stand: { kind: 'timed', fps: 3, minMs: 3_000, maxMs: 7_000 },
    sleep: { kind: 'timed', fps: 3, minMs: 10_000, maxMs: 25_000 },
    roll: { kind: 'oneshot', fps: 12, loops: 1 },
    chase: { kind: 'oneshot', fps: 14, loops: 3 },
    // Jump frames follow the arc (0 = crouch, the rest spread over the flight), so fps is unused.
    jump: { kind: 'manual', fps: 1 },
    run: { kind: 'manual', fps: 14 },
    // 4 frames swinging centre, right, centre, left: one full swing per second.
    drag: { kind: 'manual', fps: 4 },
    fall: { kind: 'manual', fps: 8 },
  },
  idleNext: [
    ['walk', 5],
    ['sit', 2],
    ['stand', 2],
    ['sleep', 1],
    ['roll', 1],
    ['chase', 1],
    ['jump', 1],
    ['run', 1],
  ],
  jump: { height: 150, hopSpeed: 80, crouchMs: 160 },
  hunt: {
    mouseSize: 56,
    runSpeed: 210,
    wanderSpeed: 90,
    fleeSpeedMin: 110,
    fleeSpeedMax: 200,
    escapeSpeed: 320,
    alertRange: 200,
    pounceRange: 170,
    pounceHeight: 80,
    pounceMaxSpeed: 520,
    catchRadius: 55,
    timeoutMs: 25_000,
  },
  voice: { model: 'onnx-community/whisper-small', language: 'th', maxMs: 5_000, minScore: -2 },
};
