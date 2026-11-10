import type { CommandableState } from './pet';

/**
 * What can be said for each command. Recognition is closed-set: the voice worker scores every
 * phrase here against the recording, so a command is only ever heard through one of these, and
 * a new way of saying something has to be added here. Thai, to match CONFIG.voice.language.
 */
export const VOICE_COMMANDS: ReadonlyArray<readonly [CommandableState, readonly string[]]> = [
  ['run', ['ไล่หนู', 'จับหนู', 'วิ่งไล่หนู', 'ไปจับหนู', 'ล่าหนู', 'หนู', 'วิ่ง']],
  ['chase', ['โดนัท', 'ไล่โดนัท', 'หมุน', 'หมุนตัว', 'ไล่หาง']],
  ['jump', ['กระโดด', 'โดด']],
  ['stand', ['ยืน', 'ยืนขึ้น', 'ลุก', 'ลุกขึ้น']],
  ['sit', ['นั่ง', 'นั่งลง']],
  ['sleep', ['นอน', 'ไปนอน', 'นอนหลับ', 'หลับ']],
  ['roll', ['กลิ้ง', 'กลิ้งตัว', 'ม้วนตัว']],
  ['walk', ['เดิน', 'ไปเดิน', 'เดินเล่น']],
  ['idle', ['ตื่น', 'ตื่นได้แล้ว', 'หยุด']],
];

/** Every phrase, in the order their scores come back from the worker. */
export const VOICE_PHRASES: readonly string[] = VOICE_COMMANDS.flatMap(([, phrases]) => phrases);

const PHRASE_COMMANDS: readonly CommandableState[] = VOICE_COMMANDS.flatMap(([command, phrases]) =>
  phrases.map(() => command),
);

export interface VoiceGuess {
  command: CommandableState;
  /** The phrase that fits the recording best. */
  phrase: string;
  /** How well it fits: average log-probability per token, 0 = certain. */
  score: number;
}

/**
 * Picks the best-fitting phrase. The caller decides whether its score is good enough to act on.
 * @param scores one score per VOICE_PHRASES entry
 */
export function bestCommand(scores: readonly number[]): VoiceGuess {
  if (scores.length !== VOICE_PHRASES.length) {
    throw new Error(`expected ${VOICE_PHRASES.length} phrase scores, got ${scores.length}`);
  }
  let top = 0;
  scores.forEach((score, i) => {
    if (score > (scores[top] ?? Number.NEGATIVE_INFINITY)) top = i;
  });
  const command = PHRASE_COMMANDS[top];
  const phrase = VOICE_PHRASES[top];
  const score = scores[top];
  if (command === undefined || phrase === undefined || score === undefined) {
    throw new Error('no voice commands defined');
  }
  return { command, phrase, score };
}
