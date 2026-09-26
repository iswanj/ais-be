import type { FastifyBaseLogger } from 'fastify';
import type { VesselPosition, VesselStore } from '../vessels/types.js';

const FLUSH_INTERVAL_MS = 250;
const BATCH_SIZE = 500;
const MAX_PENDING_VESSELS = 50_000;

export class BatchWriter {
  private readonly pending = new Map<number, VesselPosition>();
  private timer: NodeJS.Timeout | undefined;
  private drainPromise: Promise<void> | undefined;
  private stopping = false;
  private dropped = 0;
  private retryAfter = 0;

  constructor(private readonly store: VesselStore, private readonly logger: FastifyBaseLogger) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.flush(); }, FLUSH_INTERVAL_MS);
  }

  enqueue(position: VesselPosition): void {
    if (this.stopping) return;
    this.put(position);
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
    if (this.pending.size > 0) await this.flush(true);
    if (this.pending.size > 0) {
      this.logger.error({ pending: this.pending.size }, 'AIS positions remained unwritten at shutdown');
    }
  }

  private async drain(): Promise<void> {
    while (this.pending.size > 0) {
      const batch: VesselPosition[] = [];
      for (const [mmsi, position] of this.pending) {
        batch.push(position);
        this.pending.delete(mmsi);
        if (batch.length === BATCH_SIZE) break;
      }
      try {
        await this.store.upsertBatch(batch);
        this.retryAfter = 0;
        const oldestDelayMs = Date.now() - Math.min(...batch.map((item) => item.receivedAt.getTime()));
        if (oldestDelayMs > 1_000) {
          this.logger.warn({ count: batch.length, pending: this.pending.size, oldestDelayMs }, 'AIS write delay exceeded one second');
        }
      } catch (error) {
        for (const position of batch) this.put(position);
        this.retryAfter = Date.now() + 1_000;
        this.logger.error({ err: error, pending: this.pending.size }, 'AIS batch write failed; will retry');
        break;
      }
    }
  }

  private put(position: VesselPosition): void {
    const current = this.pending.get(position.mmsi);
    if (current && current.receivedAt >= position.receivedAt) return;
    if (current) this.pending.delete(position.mmsi);
    if (this.pending.size >= MAX_PENDING_VESSELS) {
      const oldestKey = this.pending.keys().next().value;
      const oldest = oldestKey === undefined ? undefined : this.pending.get(oldestKey);
      if (oldest && oldest.receivedAt >= position.receivedAt) {
        this.recordDrop();
        return;
      }
      if (oldestKey !== undefined) this.pending.delete(oldestKey);
      this.recordDrop();
    }
    this.pending.set(position.mmsi, position);
  }

  private recordDrop(): void {
    this.dropped++;
    if (this.dropped === 1 || this.dropped % 1_000 === 0) {
      this.logger.warn({ pending: this.pending.size, dropped: this.dropped }, 'AIS write queue is full');
    }
  }
}
