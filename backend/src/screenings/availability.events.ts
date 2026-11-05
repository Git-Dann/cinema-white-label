import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

export interface AvailabilityChange {
  screeningId: string;
  changes: { seatId: string; state: 'available' | 'held' | 'sold' | 'blocked' }[];
}

/**
 * In-process availability fan-out for SSE clients. With more than one API
 * instance this becomes a Redis pub/sub channel; the interface stays the same
 * (see docs/architecture.md, "Scaling availability updates").
 */
@Injectable()
export class AvailabilityEvents {
  private readonly emitter = new EventEmitter();
  constructor() {
    this.emitter.setMaxListeners(0);
  }
  publish(change: AvailabilityChange) {
    if (change.changes.length) this.emitter.emit(change.screeningId, change);
  }
  subscribe(screeningId: string, fn: (c: AvailabilityChange) => void): () => void {
    this.emitter.on(screeningId, fn);
    return () => this.emitter.off(screeningId, fn);
  }
}
