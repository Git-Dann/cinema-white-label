import { Injectable } from '@nestjs/common';

/** Injectable time source so hold expiry and scheduling can be tested deterministically. */
@Injectable()
export class Clock {
  private offsetMs = 0;
  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }
  /** Test helper: move time forward. */
  advance(ms: number) {
    this.offsetMs += ms;
  }
  reset() {
    this.offsetMs = 0;
  }
}
