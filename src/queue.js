'use strict';

class CommandQueue {
  constructor({ config, logger }) {
    this.config = config;
    this.log = logger;
    this.pending = [];
    this.running = false;
    this.handler = null;
    this._abortController = null;
  }

  setHandler(fn) {
    this.handler = fn;
  }

  push(event) {
    if (event.type === 'heartbeat' && (this.running || this.pending.length > 0)) return;

    // Steer mode: chat message while running → interrupt immediately
    if (this.config?.agent?.mode === 'steer' && this.running && event.type === 'chat') {
      this.interrupt();
    }

    this.pending.push(event);
    this._drain();
  }

  interrupt() {
    this._abortController?.abort();
  }

  createAbortController() {
    this._abortController = new AbortController();
    return this._abortController;
  }

  disposeAbortController() {
    this._abortController = null;
  }

  get isInterrupted() {
    return this._abortController?.signal.aborted ?? false;
  }

  clearInterrupt() {
    this._abortController = null;
  }

  async _drain() {
    if (this.running || !this.handler) return;
    this.running = true;
    this.clearInterrupt();
    try {
      while (this.pending.length > 0) {
        const batch = this.pending.splice(0, this.pending.length);
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
        // If interrupted mid-drain, break and let new event drain
        if (this._interrupted && this.pending.length > 0) break;
      }
    } finally {
      this.running = false;
      this.clearInterrupt();
    }
  }

  get busy() {
    return this.running;
  }
}

module.exports = { CommandQueue };
