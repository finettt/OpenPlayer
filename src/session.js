'use strict';

const fs = require('fs');
const path = require('path');

class SessionManager {
  constructor(config, logger) {
    this.config = config;
    this.log = logger;
    this.messages = [];
    this.summary = null;
    this.todos = [];
    this._nextTodoId = 1;
    this._ensureStorage();
    this._loadTodos();
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

    let tools = '';
    try {
      const toolsText = fs.readFileSync(this.config.storage.toolsFile, 'utf8').trim();
      tools = `\n\n## Available Tools\n${toolsText}`;
    } catch {
      this.log.warn('TOOLS.md not found');
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

    const todoBlock = this._buildTodoBlock();

    return { role: 'system', content: soul + tools + memory + summaryBlock + todoBlock };
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

  // --- Todo management ---

  _buildTodoBlock() {
    const active = this.todos.filter((t) => t.status !== 'completed');
    if (active.length === 0) return '';

    const lines = active.map((t) => {
      const mark = t.status === 'in_progress' ? 'in_progress' : 'pending';
      return `- [${t.id}] [${mark}] ${t.text}`;
    });
    return `\n\n## Your current tasks:\n${lines.join('\n')}`;
  }

  _loadTodos() {
    const file = this.config.storage.todoFile;
    if (!fs.existsSync(file)) {
      this.todos = [];
      this._nextTodoId = 1;
      return;
    }
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.todos = Array.isArray(data) ? data : [];
      this._nextTodoId = this.todos.length > 0
        ? Math.max(...this.todos.map((t) => t.id)) + 1
        : 1;
      this.log.info(`Loaded ${this.todos.length} todo(s) from disk`);
    } catch (err) {
      this.log.warn(`Failed to load todos: ${err.message}`);
      this.todos = [];
      this._nextTodoId = 1;
    }
  }

  _saveTodos() {
    try {
      fs.writeFileSync(this.config.storage.todoFile, JSON.stringify(this.todos, null, 2));
    } catch (err) {
      this.log.warn(`Failed to save todos: ${err.message}`);
    }
  }

  todoAction(action, params = {}) {
    switch (action) {
      case 'add': {
        const todo = {
          id: this._nextTodoId++,
          text: params.text,
          status: 'pending',
          createdAt: new Date().toISOString(),
        };
        this.todos.push(todo);
        this._saveTodos();
        this.log.info(`Todo added: [${todo.id}] ${todo.text}`);
        return `Task #${todo.id} added: "${todo.text}"`;
      }

      case 'list': {
        if (this.todos.length === 0) return 'No tasks.';
        const lines = this.todos.map((t) => {
          const mark = t.status === 'completed' ? 'x' : t.status === 'in_progress' ? '-' : ' ';
          return `- [${t.id}] [${mark}] ${t.text} (${t.status})`;
        });
        return `Tasks:\n${lines.join('\n')}`;
      }

      case 'start': {
        const todo = this.todos.find((t) => t.id === params.id);
        if (!todo) return `Error: task #${params.id} not found.`;
        if (todo.status === 'completed') return `Error: task #${params.id} is already completed.`;
        todo.status = 'in_progress';
        this._saveTodos();
        this.log.info(`Todo started: [${todo.id}] ${todo.text}`);
        return `Task #${todo.id} started: "${todo.text}"`;
      }

      case 'complete': {
        const todo = this.todos.find((t) => t.id === params.id);
        if (!todo) return `Error: task #${params.id} not found.`;
        if (todo.status === 'completed') return `Task #${params.id} is already completed.`;
        todo.status = 'completed';
        this._saveTodos();
        this.log.info(`Todo completed: [${todo.id}] ${todo.text}`);
        return `Task #${todo.id} completed: "${todo.text}"`;
      }

      case 'remove': {
        const idx = this.todos.findIndex((t) => t.id === params.id);
        if (idx === -1) return `Error: task #${params.id} not found.`;
        const [removed] = this.todos.splice(idx, 1);
        this._saveTodos();
        this.log.info(`Todo removed: [${removed.id}] ${removed.text}`);
        return `Task #${removed.id} removed: "${removed.text}"`;
      }

      case 'clear': {
        if (params.completedOnly === false) {
          const count = this.todos.length;
          this.todos = [];
          this._saveTodos();
          this.log.info(`All ${count} todos cleared`);
          return `Cleared all ${count} tasks.`;
        }
        const before = this.todos.length;
        this.todos = this.todos.filter((t) => t.status !== 'completed');
        const removed = before - this.todos.length;
        this._saveTodos();
        this.log.info(`Cleared ${removed} completed todos`);
        return removed > 0 ? `Cleared ${removed} completed task(s).` : 'No completed tasks to clear.';
      }

      default:
        return `Error: unknown todo action "${action}".`;
    }
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
