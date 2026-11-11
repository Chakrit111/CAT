export const PET_STATES = [
  'idle',
  'walk',
  'sit',
  'stand',
  'sleep',
  'roll',
  'chase',
  'jump',
  'run',
  'drag',
  'fall',
] as const;
export type PetState = (typeof PET_STATES)[number];

export interface SpriteManifest {
  /** Window / canvas edge length in DIP. */
  size: number;
  /** file:// URLs per state. Already fallback-resolved: every state has at least one frame. */
  frames: Record<PetState, string[]>;
  /**
   * file:// URLs of the pack's own wheel pictures (wheel/<n>.png, or wheel.png), drawn instead of the
   * app's wheel. Several frames loop, each a step of the turn (scripts/wheel_rungs.py makes them).
   */
  wheel?: string[];
  /** file:// URLs of wheel-enter/<n>.png: the pet alone, drawn over the still wheel, played once as it gets in. */
  wheelEnter?: string[];
}

export interface FrameMessage {
  state: PetState;
  frame: number;
  /** true = mirror horizontally. Sprites are authored facing right. */
  flip: boolean;
  /** Set while the pet runs in its wheel: draw the wheel, turning, and the pet smaller inside it. */
  wheel?: WheelMessage;
}

export interface WheelMessage {
  /** The pet's frame is drawn this much smaller, so it fits inside the wheel. */
  scale: number;
  turnsPerSecond: number;
  floor: number;
  centerX: number;
  /** [x, y, radius] fractions: turn this circle of the wheel picture; empty = play frames. */
  hub: number[];
  /** [x, y, radiusX, radiusY] fractions: draw the pet only inside this ellipse; empty = all of it. */
  opening: number[];
}

export interface VoiceListenRequest {
  /** Stop listening after this long, whether or not anything was said. */
  maxMs: number;
}

export interface SoundMessage {
  /** file:// URL of the sound to play, cutting off the one playing; null = stop the one playing. */
  url: string | null;
  /** 0..1 */
  volume: number;
}

export interface MouseMessage {
  /** true = mirror horizontally. The mouse is drawn facing right. */
  flip: boolean;
  /** false while it stands still, so its legs stop. */
  moving: boolean;
}

/** API exposed to the renderer through the preload script. */
export interface PetApi {
  getManifest(): Promise<SpriteManifest>;
  ready(): void;
  onFrame(listener: (msg: FrameMessage) => void): void;
  pointerDown(): void;
  pointerUp(): void;
  contextMenu(): void;
  /** Main asks for one spoken command: show the mic and record. */
  onVoiceListen(listener: (request: VoiceListenRequest) => void): void;
  /** Main closes the voice session: stop recording and hide the mic. */
  onVoiceEnd(listener: () => void): void;
  /** 16 kHz mono samples of what was said, or null if nothing was heard or the mic failed. */
  voiceAudio(pcm: Float32Array | null, error?: string): void;
  /** Main tells the cat to make a sound, or to stop the one it is making. */
  onSound(listener: (msg: SoundMessage) => void): void;
}

/** API exposed to the mouse window through its preload script. */
export interface MouseApi {
  onState(listener: (msg: MouseMessage) => void): void;
}

export const IPC = {
  manifest: 'pet:manifest',
  ready: 'pet:ready',
  frame: 'pet:frame',
  pointerDown: 'pet:pointer-down',
  pointerUp: 'pet:pointer-up',
  contextMenu: 'pet:context-menu',
  voiceListen: 'pet:voice-listen',
  voiceEnd: 'pet:voice-end',
  voiceAudio: 'pet:voice-audio',
  sound: 'pet:sound',
  mouseState: 'mouse:state',
} as const;
