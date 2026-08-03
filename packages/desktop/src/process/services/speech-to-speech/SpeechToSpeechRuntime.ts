import type { EventEmitter } from 'node:events';

export type SpeechRuntimeChild = EventEmitter & {
  kill: (signal?: NodeJS.Signals) => boolean;
  stderr: EventEmitter | null;
  exitCode?: number | null;
};

export type SpeechRuntimeSpawnOptions = {
  env: NodeJS.ProcessEnv;
  windowsHide: boolean;
};

export type SpeechToSpeechRuntimeDeps = {
  isPortOpen: (port: number) => Promise<boolean>;
  resolvePythonPath: () => Promise<string | null>;
  spawn: (command: string, args: readonly string[], options: SpeechRuntimeSpawnOptions) => SpeechRuntimeChild;
  waitForPort: (port: number, child: SpeechRuntimeChild) => Promise<void>;
};

export type SpeechRuntimeReady = {
  endpoint: string;
  reused: boolean;
};

const PORT = 8765;
const ENDPOINT = `ws://127.0.0.1:${PORT}/v1/realtime`;
const MAX_LOG_LENGTH = 4000;

const PIPELINE_ARGS = [
  '-m',
  'speech_to_speech.s2s_pipeline',
  '--mode',
  'realtime',
  '--ws_host',
  '127.0.0.1',
  '--ws_port',
  String(PORT),
  '--device',
  'cuda',
  '--stt',
  'parakeet-tdt',
  '--llm_backend',
  'transformers',
  '--model_name',
  'Qwen/Qwen3-4B-Instruct-2507',
  '--tts',
  'qwen3',
  '--qwen3_tts_model_name',
  'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
  '--qwen3_tts_device',
  'cuda',
  '--qwen3_tts_backend',
  'torch',
  '--qwen3_tts_dtype',
  'bfloat16',
  '--no_qwen3_tts_non_streaming_mode',
  '--language',
  'auto',
  '--enable_live_transcription',
] as const;

export class SpeechToSpeechRuntime {
  private child: SpeechRuntimeChild | null = null;
  private starting: Promise<SpeechRuntimeReady> | null = null;
  private stderrTail = '';

  constructor(private readonly deps: SpeechToSpeechRuntimeDeps) {}

  async ensureReady(): Promise<SpeechRuntimeReady> {
    if (await this.deps.isPortOpen(PORT)) return { endpoint: ENDPOINT, reused: true };
    if (this.starting) return this.starting;

    this.starting = this.start().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  stop(): void {
    this.child?.kill();
    this.child = null;
  }

  private async start(): Promise<SpeechRuntimeReady> {
    const pythonPath = await this.deps.resolvePythonPath();
    if (!pythonPath) throw new Error('SPEECH_RUNTIME_MISSING');

    this.stderrTail = '';
    const child = this.deps.spawn(pythonPath, PIPELINE_ARGS, {
      env: { ...process.env, HF_HUB_DISABLE_XET: '1', PYTHONUTF8: '1' },
      windowsHide: true,
    });
    this.child = child;
    child.stderr?.on('data', (chunk: Buffer | string) => {
      this.stderrTail = `${this.stderrTail}${String(chunk)}`.slice(-MAX_LOG_LENGTH);
    });
    child.once('exit', () => {
      if (this.child === child) this.child = null;
    });

    try {
      await this.deps.waitForPort(PORT, child);
      return { endpoint: ENDPOINT, reused: false };
    } catch (error) {
      child.kill();
      if (this.child === child) this.child = null;
      const detail = this.stderrTail.trim();
      throw new Error(detail || (error instanceof Error ? error.message : String(error)), {
        cause: error,
      });
    }
  }
}
