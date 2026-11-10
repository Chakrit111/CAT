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
}

export interface FrameMessage {
  state: PetState;
  frame: number;
  /** true = mirror horizontally. Sprites are authored facing right. */
  flip: boolean;
}

export interface VoiceListenRequest {
  /** Stop listening after this long, whether or not anything was said. */
  maxMs: number;
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
  mouseState: 'mouse:state',
} as const;
