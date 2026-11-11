import type { CommandableState } from './pet';

/** For each command, the phrases that trigger it (from the pet pack's `voice.phrases`). */
export type PhraseTable = ReadonlyArray<readonly [CommandableState, readonly string[]]>;

export interface VoiceGuess {
  command: CommandableState;
  /** The phrase that fits the recording best. */
  phrase: string;
  /** How well it fits: average log-probability per token, 0 = certain. */
  score: number;
}

/**
 * The phrases the pet listens for. Recognition is closed-set: the voice worker scores every phrase
 * against the recording, so a command is only ever heard through one of these, and a new way of
 * saying something has to be added to the pack's pet.json.
 */
export class VoiceCommands {
  /** Every phrase, in the order their scores come back from the worker. */
  readonly phrases: readonly string[];
  private readonly commands: readonly CommandableState[];

  constructor(table: PhraseTable) {
    this.phrases = table.flatMap(([, phrases]) => phrases);
    this.commands = table.flatMap(([command, phrases]) => phrases.map(() => command));
  }

  /**
   * Picks the best-fitting phrase. The caller decides whether its score is good enough to act on.
   * @param scores one score per entry of `phrases`
   */
  best(scores: readonly number[]): VoiceGuess {
    if (scores.length !== this.phrases.length) {
      throw new Error(`expected ${this.phrases.length} phrase scores, got ${scores.length}`);
    }
    let top = 0;
    scores.forEach((score, i) => {
      if (score > (scores[top] ?? Number.NEGATIVE_INFINITY)) top = i;
    });
    const command = this.commands[top];
    const phrase = this.phrases[top];
    const score = scores[top];
    if (command === undefined || phrase === undefined || score === undefined) {
      throw new Error('no voice phrases defined');
    }
    return { command, phrase, score };
  }
}
