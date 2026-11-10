import { utilityProcess, type UtilityProcess } from 'electron';

export interface VoiceOptions {
  model: string;
  /** Whisper language code of the phrases, e.g. 'th'. */
  language: string;
  /** The phrases a recording is scored against. */
  phrases: readonly string[];
  /** Where downloaded model files are kept between runs. */
  cacheDir: string;
}

export type WorkerRequest =
  | ({ type: 'init' } & VoiceOptions)
  | { type: 'score'; id: number; pcm: Float32Array };

export type WorkerReply =
  | { type: 'progress'; percent: number }
  | { type: 'ready' }
  | { type: 'failed'; message: string }
  | { type: 'result'; id: number; scores: number[] }
  | { type: 'error'; id: number; message: string };

const SCORE_TIMEOUT_MS = 30_000;

interface Pending {
  resolve(scores: number[]): void;
  reject(err: Error): void;
  timer: NodeJS.Timeout;
}

/**
 * Speech recognition in a utility process, so loading the model and running it never stall the pet's tick loop.
 * The model is downloaded on first run and read from `cacheDir` afterwards.
 */
export class Voice {
  status: 'loading' | 'ready' | 'failed' = 'loading';

  private percent = 0;
  private error = '';
  private disposed = false;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly child: UtilityProcess;

  constructor(workerPath: string, options: VoiceOptions) {
    this.child = utilityProcess.fork(workerPath, [], { serviceName: 'Desktop Pet voice' });
    this.child.on('message', (reply: WorkerReply) => this.onReply(reply));
    this.child.on('exit', (code) => {
      if (!this.disposed) this.fail(`voice worker exited (code ${code})`);
    });
    this.post({ type: 'init', ...options });
  }

  /** One line for the menu saying where voice stands. */
  get label(): string {
    if (this.status === 'failed') return `Voice unavailable: ${this.error}`;
    return this.status === 'ready' ? 'Voice ready' : `Voice: loading model ${this.percent}%`;
  }

  /**
   * @param pcm 16 kHz mono samples
   * @returns for each phrase, in the order given to the constructor, how well it fits the
   *          recording: average log-probability per token, 0 = certain
   */
  score(pcm: Float32Array): Promise<number[]> {
    if (this.status !== 'ready') return Promise.reject(new Error(this.label));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.settle(id)?.reject(new Error('voice recognition timed out'));
      }, SCORE_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.post({ type: 'score', id, pcm });
    });
  }

  dispose(): void {
    this.disposed = true;
    this.child.kill();
  }

  private post(request: WorkerRequest): void {
    this.child.postMessage(request);
  }

  /** Removes a pending request so it can be resolved or rejected exactly once. */
  private settle(id: number): Pending | undefined {
    const entry = this.pending.get(id);
    if (entry) {
      clearTimeout(entry.timer);
      this.pending.delete(id);
    }
    return entry;
  }

  private fail(message: string): void {
    if (this.status !== 'failed') {
      this.status = 'failed';
      this.error = message;
      console.error(`[voice] ${message}`);
    }
    for (const id of [...this.pending.keys()]) this.settle(id)?.reject(new Error(message));
  }

  private onReply(reply: WorkerReply): void {
    switch (reply.type) {
      case 'progress':
        this.percent = reply.percent;
        break;
      case 'ready':
        this.status = 'ready';
        console.log('[voice] model ready');
        break;
      case 'failed':
        this.fail(reply.message);
        break;
      case 'result':
        this.settle(reply.id)?.resolve(reply.scores);
        break;
      case 'error':
        this.settle(reply.id)?.reject(new Error(reply.message));
        break;
    }
  }
}
