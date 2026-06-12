'use strict';

class CommandQueue {
  constructor(logger) {
    this.log = logger;
    this.pending = [];
    this.running = false;
    this.handler = null;
  }

  setHandler(fn) {
    this.handler = fn;
  }

  push(event) {
    if (event.type === 'heartbeat' && (this.running || this.pending.length > 0)) return;
    this.pending.push(event);

    this._drain();
  }

  async _drain() {
    if (this.running || !this.handler) return;
    this.running = true;
    try {
      while (this.pending.length > 0) {
        const batch = this.pending.splice(0, this.pending.length);
        try {
          await this.handler(batch);
        } catch (err) {
          this.log.error(`Error processing batch: ${err.message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  get busy() {
    return this.running;
  }
}

module.exports = { CommandQueue };
