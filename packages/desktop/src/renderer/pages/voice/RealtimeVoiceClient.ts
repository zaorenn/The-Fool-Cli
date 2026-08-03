import {
  buildAudioAppendEvent,
  buildSessionUpdateEvent,
  parseRealtimeServerEvent,
  validateRealtimeEndpoint,
  type NormalizedRealtimeEvent,
} from './realtimeProtocol';

export type RealtimeSocket = {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send: (data: string) => void;
  close: () => void;
};

export type RealtimeVoiceClientOptions = {
  endpoint: string;
  language: string;
  createSocket?: (endpoint: string) => RealtimeSocket;
  onEvent: (event: NormalizedRealtimeEvent) => void;
};

const OPEN = 1;

export class RealtimeVoiceClient {
  private readonly endpoint: string;
  private readonly language: string;
  private readonly createSocket: (endpoint: string) => RealtimeSocket;
  private readonly onEvent: (event: NormalizedRealtimeEvent) => void;
  private socket: RealtimeSocket | null = null;

  constructor(options: RealtimeVoiceClientOptions) {
    this.endpoint = options.endpoint;
    this.language = options.language;
    this.createSocket = options.createSocket ?? ((endpoint) => new WebSocket(endpoint) as unknown as RealtimeSocket);
    this.onEvent = options.onEvent;
  }

  connect(): Promise<void> {
    if (!validateRealtimeEndpoint(this.endpoint)) {
      return Promise.reject(new Error('Unsafe realtime endpoint'));
    }

    return new Promise((resolve, reject) => {
      const socket = this.createSocket(this.endpoint);
      this.socket = socket;
      socket.onopen = () => {
        this.send(buildSessionUpdateEvent(this.language));
        resolve();
      };
      socket.onmessage = ({ data }) => {
        try {
          const event = parseRealtimeServerEvent(JSON.parse(data) as unknown);
          if (event) this.onEvent(event);
        } catch {
          // A malformed server frame is isolated to that frame.
        }
      };
      socket.onerror = () => reject(new Error('Realtime connection failed'));
      socket.onclose = () => {
        if (this.socket === socket) this.socket = null;
      };
    });
  }

  appendAudio(pcm16Base64: string): boolean {
    if (!this.isOpen()) return false;
    this.send(buildAudioAppendEvent(pcm16Base64));
    return true;
  }

  sendToolResult(callId: string, output: Record<string, unknown>): boolean {
    if (!this.isOpen()) return false;
    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(output),
      },
    });
    this.send({ type: 'response.create' });
    return true;
  }

  interrupt(): void {
    if (this.isOpen()) this.send({ type: 'response.cancel' });
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
  }

  private isOpen(): boolean {
    return this.socket?.readyState === OPEN;
  }

  private send(event: object): void {
    this.socket?.send(JSON.stringify(event));
  }
}
