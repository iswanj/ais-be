import type { FastifyBaseLogger } from 'fastify';
import type { VesselPosition, VesselStore } from '../vessels/types.js';

const FLUSH_INTERVAL_MS = 250;
const BATCH_SIZE = 500;
const MAX_PENDING_REPORTS = 50_000;

export class BatchWriter {
  private readonly pending: VesselPosition[] = [];
  private timer: NodeJS.Timeout | undefined;
  private drainPromise: Promise<void> | undefined;
  private stopping = false;
  private dropped = 0;
  private retryAfter = 0;

  constructor(
    private readonly store: VesselStore,
    private readonly logger: FastifyBaseLogger,
    private readonly onPersisted?: (reports: VesselPosition[]) => void,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.flush(); }, FLUSH_INTERVAL_MS);
  }

  enqueue(position: VesselPosition): void {
    if (this.stopping) return;
    if (this.pending.length >= MAX_PENDING_REPORTS) {
      this.recordDrop();
      return;
    }
    this.pending.push(position);
  }

  flush(force = false): Promise<void> {
    if (this.drainPromise) return this.drainPromise;
    if (!force && Date.now() < this.retryAfter) return Promise.resolve();
    this.drainPromise = this.drain().finally(() => { this.drainPromise = undefined; });
    return this.drainPromise;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.flush(true);
    if (this.pending.length > 0) await this.flush(true);
    if (this.pending.length > 0) {
      this.logger.error({ pending: this.pending.length }, 'AIS reports remained unwritten at shutdown');
    }
  }

  private async drain(): Promise<void> {
    while (this.pending.length > 0) {
      const batch = this.pending.splice(0, BATCH_SIZE);
      try {
        await this.store.persistBatch(batch);
        this.retryAfter = 0;
        this.onPersisted?.(batch);
        const oldestDelayMs = Date.now() - Math.min(...batch.map((item) => item.receivedAt.getTime()));
        if (oldestDelayMs > 1_000) {
          this.logger.warn({ count: batch.length, pending: this.pending.length, oldestDelayMs }, 'AIS write delay exceeded one second');
        }
      } catch (error) {
        this.pending.unshift(...batch);
        if (this.pending.length > MAX_PENDING_REPORTS) {
          const overflow = this.pending.length - MAX_PENDING_REPORTS;
          this.pending.splice(0, overflow);
          this.recordDrop(overflow);
        }
        this.retryAfter = Date.now() + 1_000;
        this.logger.error({ err: error, pending: this.pending.length }, 'AIS batch write failed; will retry');
        break;
      }
    }
  }

  private recordDrop(count = 1): void {
    this.dropped += count;
    if (this.dropped === 1 || this.dropped % 1_000 === 0) {
      this.logger.warn({ pending: this.pending.length, dropped: this.dropped }, 'AIS report queue is full');
    }
  }
}
