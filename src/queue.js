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
        // Fire any per-event consume hooks BEFORE the handler runs, so that
        // event producers (e.g. damage aggregator) can reset their state and
        // start a fresh aggregation window for any subsequent damage.
        for (const ev of batch) {
          if (typeof ev._onConsume === 'function') {
            try { ev._onConsume(); } catch { /* ignore */ }
          }
        }
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
