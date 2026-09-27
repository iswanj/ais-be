import type { FastifyBaseLogger } from 'fastify';
import WebSocket, { type RawData } from 'ws';
import type { BoundingBox } from '../config/env.js';
import { parsePositionReport } from './position-report.js';
import type { VesselPosition } from '../vessels/types.js';

const DEFAULT_URL = 'wss://stream.aisstream.io/v0/stream';

export class AisStreamClient {
  private socket: WebSocket | undefined;
  private retryTimer: NodeJS.Timeout | undefined;
  private retryAttempt = 0;
  private stopped = true;

  constructor(
    private readonly apiKey: string,
    private readonly boundingBoxes: BoundingBox[],
    private readonly writer: { enqueue(position: VesselPosition): void },
    private readonly logger: FastifyBaseLogger,
    private readonly url = DEFAULT_URL,
    private readonly retryBaseMs = 1_000,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    if (!socket || socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => { socket.terminate(); resolve(); }, 2_000);
      socket.once('close', () => { clearTimeout(timeout); resolve(); });
      if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
      else socket.close();
    });
  }

  private connect(): void {
    if (this.stopped) return;
    const socket = new WebSocket(this.url, { perMessageDeflate: true, handshakeTimeout: 5_000 });
    this.socket = socket;
    socket.on('open', () => {
      socket.send(JSON.stringify({
        APIKey: this.apiKey,
        BoundingBoxes: this.boundingBoxes,
        FilterMessageTypes: ['PositionReport'],
      }));
      this.logger.info('AISstream connected and subscribed');
    });
    socket.on('message', (data: RawData) => {
      const receivedAt = new Date();
      try {
        const frame = JSON.parse(decodeFrame(data)) as unknown;
        if (isConfirmation(frame)) {
          this.retryAttempt = 0;
          this.logger.info({ compressionEnabled: frame.Message.CompressionEnabled }, 'AISstream subscription confirmed');
          return;
        }
        const position = parsePositionReport(frame, receivedAt);
        if (position) this.writer.enqueue(position);
      } catch (error) {
        this.logger.warn({ err: error }, 'invalid AISstream frame');
      }
    });
    socket.on('error', (error) => {
      this.logger.error({ err: error }, 'AISstream connection error');
      socket.terminate();
    });
    socket.on('close', (code) => {
      if (this.socket === socket) this.socket = undefined;
      if (this.stopped) return;
      const delayMs = Math.min(30_000, this.retryBaseMs * 2 ** Math.min(this.retryAttempt++, 5));
      const jitterMs = Math.floor(Math.random() * delayMs * 0.25);
      this.logger.warn({ code, retryInMs: delayMs + jitterMs }, 'AISstream disconnected');
      this.retryTimer = setTimeout(() => {
        this.retryTimer = undefined;
        this.connect();
      }, delayMs + jitterMs);
    });
  }
}

function decodeFrame(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

function isConfirmation(value: unknown): value is { MessageType: 'SubscriptionConfirmation'; Message: { CompressionEnabled: boolean } } {
  if (typeof value !== 'object' || value === null || !('MessageType' in value)) return false;
  return value.MessageType === 'SubscriptionConfirmation' && 'Message' in value &&
    typeof value.Message === 'object' && value.Message !== null &&
    'CompressionEnabled' in value.Message && typeof value.Message.CompressionEnabled === 'boolean';
}
