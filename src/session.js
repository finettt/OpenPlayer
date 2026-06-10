'use strict';

const fs = require('fs');
const path = require('path');

class SessionManager {
  constructor(config, logger) {
    this.config = config;
    this.log = logger;
    this.messages = [];
    this.summary = null;
    this._ensureStorage();
    this._loadTranscript();
  }

  _ensureStorage() {
    fs.mkdirSync(this.config.storage.dir, { recursive: true });
    if (!fs.existsSync(this.config.storage.memoryFile)) {
      fs.writeFileSync(this.config.storage.memoryFile, '# Agent Long-term Memory\n');
    }
  }

  buildSystemPrompt() {
    let soul = 'You are an AI agent in Minecraft. Use send_message to talk to players.';
    try {
      soul = fs.readFileSync(this.config.storage.soulFile, 'utf8');
    } catch {
      this.log.warn('SOUL.md not found, using default prompt');
    }

    let memory = '';
    try {
      const mem = fs.readFileSync(this.config.storage.memoryFile, 'utf8').trim();
      if (mem.split('\n').length > 1) {
        memory = `\n\n## Your long-term memory:\n${mem}`;
      }
    } catch { /* no memory — that's fine */ }

    const summaryBlock = this.summary
      ? `\n\n## Summary of previous conversation:\n${this.summary}`
      : '';

    return { role: 'system', content: soul + memory + summaryBlock };
  }

  push(message) {
    this.messages.push(message);
    this._appendTranscript(message);
  }

  getContext() {
    return [this.buildSystemPrompt(), ...this.messages];
  }

  needsCompaction() {
    return this.messages.length > this.config.agent.compaction.triggerMessages;
  }

  async compact(summarizeFn) {
    const { keepRecent } = this.config.agent.compaction;
    let cut = this.messages.length - keepRecent;
    if (cut <= 0) return;

    while (cut < this.messages.length && this.messages[cut].role === 'tool') {
      cut++;
    }
    if (cut >= this.messages.length) return;

    const oldPart = this.messages.slice(0, cut);
    try {
      const text = oldPart
        .map((m) => this._messageToText(m))
        .filter(Boolean)
        .join('\n');
      this.summary = await summarizeFn(
        `Summarize this Minecraft conversation log in 5-7 sentences, preserving player names and important facts:\n\n${text}` +
        (this.summary ? `\n\nPrevious summary:\n${this.summary}` : '')
      );
      this.messages = this.messages.slice(cut);
      this.log.info(`Compaction: ${oldPart.length} messages folded into summary`);
    } catch (err) {
      this.log.warn(`Summarization failed (${err.message}), doing hard cut`);
      this.messages = this.messages.slice(cut);
    }
  }

  _messageToText(m) {
    if (typeof m.content === 'string') return `${m.role}: ${m.content}`;
    if (Array.isArray(m.content)) {
      const texts = m.content.filter((p) => p.type === 'text').map((p) => p.text);
      return texts.length ? `${m.role}: ${texts.join(' ')}` : null;
    }
    if (m.tool_calls) {
      return `${m.role}: [called tools: ${m.tool_calls.map((t) => t.function.name).join(', ')}]`;
    }
    return null;
  }

  remember(fact) {
    const line = `- [${new Date().toISOString()}] ${fact}\n`;
    fs.appendFileSync(this.config.storage.memoryFile, line);
    this.log.info(`Remembered: ${fact}`);
  }

  _appendTranscript(message) {
    try {
      const sanitized = this._sanitizeForDisk(message);
      fs.appendFileSync(
        this.config.storage.transcriptFile,
        JSON.stringify({ ts: Date.now(), ...sanitized }) + '\n'
      );
    } catch (err) {
      this.log.warn(`Failed to write transcript: ${err.message}`);
    }
  }

  _sanitizeForDisk(message) {
    if (!this.config.logging.redactImages) return message;
    if (Array.isArray(message.content)) {
      return {
        ...message,
        content: message.content.map((part) =>
          part.type === 'image_url'
            ? { type: 'text', text: '[image redacted]' }
            : part
        ),
      };
    }
    return message;
  }

  _loadTranscript() {
    const file = this.config.storage.transcriptFile;
    if (!fs.existsSync(file)) return;
    try {
      const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
      const recent = lines.slice(-this.config.agent.compaction.keepRecent);
      const restored = [];
      for (const line of recent) {
        const { ts, ...msg } = JSON.parse(line);
        if (msg.role === 'tool' || msg.tool_calls) continue;
        restored.push(msg);
      }
      this.messages = restored;
      if (restored.length) {
        this.log.info(`Restored ${restored.length} messages from previous session`);
      }
    } catch (err) {
      this.log.warn(`Failed to restore transcript: ${err.message}`);
    }
  }
}

module.exports = { SessionManager };
