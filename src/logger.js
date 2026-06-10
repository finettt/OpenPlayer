'use strict';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

class Logger {
  constructor(scope, level = 'info') {
    this.scope = scope;
    this.level = LEVELS[level] ?? 1;
  }

  child(scope) {
    const l = new Logger(`${this.scope}:${scope}`);
    l.level = this.level;
    return l;
  }

  _log(level, msg, extra) {
    if (LEVELS[level] < this.level) return;
    const ts = new Date().toISOString();
    const line = `${ts} [${level.toUpperCase()}] [${this.scope}] ${msg}`;
    const out = level === 'error' ? console.error : console.log;
    if (extra !== undefined) out(line, extra);
    else out(line);
  }

  debug(msg, extra) { this._log('debug', msg, extra); }
  info(msg, extra)  { this._log('info', msg, extra); }
  warn(msg, extra)  { this._log('warn', msg, extra); }
  error(msg, extra) { this._log('error', msg, extra); }
}

module.exports = { Logger };
