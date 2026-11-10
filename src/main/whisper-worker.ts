// Runs Whisper inside an Electron utility process. The message protocol is defined in voice.ts.
//
// Recognition is closed-set. Free transcription of one-word Thai commands is unreliable with a
// model this size ("เดิน" comes back as "Done"), so instead the decoder is asked how likely each
// known phrase is as the exact transcript of the recording, all phrases in one batched pass.
import {
  AutoProcessor,
  AutoTokenizer,
  env,
  Tensor,
  WhisperForConditionalGeneration,
} from '@huggingface/transformers';
import type { WorkerReply, WorkerRequest } from './voice';

/** 16 kHz samples per encoder output frame. */
const SAMPLES_PER_FRAME = 320;
/**
 * Whisper always encodes a 30 s window (1500 frames) and a command fills only the start of it.
 * Scoring over the whole window takes about 5x longer than over the first 6 s, with the same
 * answers. Much less than 5 s of context does cost accuracy, hence the minimum.
 */
const MIN_FRAMES = 300;
/** Frames kept past the end of a recording that is longer than MIN_FRAMES. */
const TAIL_FRAMES = 25;

/** The parts of the transformers.js model used here. `_encode_input` is internal to the library (checked on 4.3.2). */
interface Model {
  (inputs: { encoder_outputs: Tensor; decoder_input_ids: Tensor }): Promise<{ logits: Tensor }>;
  _encode_input(
    session: 'model',
    inputs: { input_features: Tensor },
    output: 'last_hidden_state',
  ): Promise<Tensor>;
}
type Processor = (pcm: Float32Array) => Promise<{ input_features: Tensor }>;

interface Recognizer {
  processor: Processor;
  model: Model;
  /** Length of the decoder prompt: start-of-transcript, language, task, no-timestamps. */
  promptLength: number;
  /** Decoder input, one row per phrase that is not the beginning of a longer one. */
  decoderIds: Tensor;
  rowCount: number;
  rowWidth: number;
  /** Per phrase: the row that contains it, and its tokens followed by end-of-text. */
  phrases: Array<{ row: number; tokens: number[] }>;
}

const port = process.parentPort;
const reply = (message: WorkerReply): void => port.postMessage(message);
const describe = (err: unknown): string => (err instanceof Error ? err.message : String(err));

let recognizer: Recognizer | undefined;

async function init(request: Extract<WorkerRequest, { type: 'init' }>): Promise<void> {
  env.cacheDir = request.cacheDir;

  let lastPercent = -1;
  const [processor, tokenizer, model] = await Promise.all([
    AutoProcessor.from_pretrained(request.model),
    AutoTokenizer.from_pretrained(request.model),
    WhisperForConditionalGeneration.from_pretrained(request.model, {
      dtype: 'q8',
      device: 'cpu',
      progress_callback: (info) => {
        if (info.status !== 'progress_total') return;
        const percent = Math.floor(info.progress);
        if (percent === lastPercent) return;
        lastPercent = percent;
        reply({ type: 'progress', percent });
      },
    }),
  ]);

  const special = ['<|startoftranscript|>', `<|${request.language}|>`, '<|transcribe|>', '<|notimestamps|>'];
  const prompt: number[] = tokenizer.convert_tokens_to_ids(special);
  const [endOfText]: number[] = tokenizer.convert_tokens_to_ids(['<|endoftext|>']);
  if (endOfText === undefined || prompt.some((id) => typeof id !== 'number' || id < endOfText)) {
    throw new Error(`Whisper does not know the language "${request.language}"`);
  }

  const texts = request.phrases.map(
    (phrase): number[] => tokenizer.encode(phrase, { add_special_tokens: false }),
  );
  const startsWith = (long: number[], short: number[]): boolean =>
    short.length <= long.length && short.every((token, i) => token === long[i]);
  // A phrase that begins a longer one ("นั่ง" / "นั่งลง") is read off the longer one's row.
  const rows = texts.filter(
    (text, i) =>
      !texts.some(
        (other, j) => j !== i && startsWith(other, text) && (other.length > text.length || j < i),
      ),
  );

  const rowWidth = prompt.length + Math.max(...rows.map((row) => row.length));
  const ids = new BigInt64Array(rows.length * rowWidth).fill(BigInt(endOfText));
  rows.forEach((row, r) => {
    [...prompt, ...row].forEach((token, i) => {
      ids[r * rowWidth + i] = BigInt(token);
    });
  });

  recognizer = {
    processor: processor as unknown as Processor,
    model: model as unknown as Model,
    promptLength: prompt.length,
    decoderIds: new Tensor('int64', ids, [rows.length, rowWidth]),
    rowCount: rows.length,
    rowWidth,
    phrases: texts.map((text) => ({
      row: rows.findIndex((row) => startsWith(row, text)),
      tokens: [...text, endOfText],
    })),
  };
  reply({ type: 'ready' });
}

/** @returns per phrase, the average log-probability per token of that phrase being the exact transcript */
async function score(pcm: Float32Array): Promise<number[]> {
  if (!recognizer) throw new Error('model not loaded');
  const { processor, model, promptLength, decoderIds, rowCount, rowWidth, phrases } = recognizer;

  const { input_features } = await processor(pcm);
  const encoded = await model._encode_input('model', { input_features }, 'last_hidden_state');
  const frames = encoded.dims[1] ?? 0;
  const hidden = encoded.dims[2] ?? 0;
  const recorded = Math.ceil(pcm.length / SAMPLES_PER_FRAME);
  const keep = Math.min(frames, Math.max(MIN_FRAMES, recorded + TAIL_FRAMES));
  const audio = (encoded.data as Float32Array).subarray(0, keep * hidden);
  // Every row attends to the same audio.
  const tiled = new Float32Array(audio.length * rowCount);
  for (let r = 0; r < rowCount; r++) tiled.set(audio, r * audio.length);

  const { logits } = await model({
    encoder_outputs: new Tensor('float32', tiled, [rowCount, keep, hidden]),
    decoder_input_ids: decoderIds,
  });
  const vocab = logits.dims[2] ?? 0;
  const data = logits.data as Float32Array;

  // log-softmax normaliser per decoder position, computed once however many phrases share it
  const normalisers = new Map<number, number>();
  const logProb = (row: number, position: number, token: number): number => {
    const start = (row * rowWidth + position) * vocab;
    let normaliser = normalisers.get(start);
    if (normaliser === undefined) {
      let max = Number.NEGATIVE_INFINITY;
      for (let i = start; i < start + vocab; i++) max = Math.max(max, data[i] ?? max);
      let sum = 0;
      for (let i = start; i < start + vocab; i++) sum += Math.exp((data[i] ?? max) - max);
      normaliser = max + Math.log(sum);
      normalisers.set(start, normaliser);
    }
    return (data[start + token] ?? Number.NEGATIVE_INFINITY) - normaliser;
  };

  // The decoder output at position p predicts the token at p + 1. Averaging per token keeps
  // long phrases comparable with short ones; a plain sum favours whichever has fewest tokens.
  return phrases.map(
    ({ row, tokens }) =>
      tokens.reduce((sum, token, i) => sum + logProb(row, promptLength - 1 + i, token), 0) /
      tokens.length,
  );
}

port.on('message', (event) => {
  const request = event.data as WorkerRequest;
  if (request.type === 'init') {
    init(request).catch((err: unknown) => reply({ type: 'failed', message: describe(err) }));
    return;
  }
  score(request.pcm).then(
    (scores) => reply({ type: 'result', id: request.id, scores }),
    (err: unknown) => reply({ type: 'error', id: request.id, message: describe(err) }),
  );
});
