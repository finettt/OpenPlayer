'use strict';

class ToolRegistry {
  constructor(logger) {
    this.log = logger;
    this.tools = new Map();
  }

  register(tool) {
    if (!tool.name || typeof tool.execute !== 'function') {
      throw new Error(`Invalid tool: ${JSON.stringify(tool.name)}`);
    }
    this.tools.set(tool.name, tool);
    this.log.debug(`Tool registered: ${tool.name}`);
  }

  getSchemas() {
    return [...this.tools.values()].map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters ?? { type: 'object', properties: {} },
      },
    }));
  }

  async execute(name, rawArgs, context) {
    const tool = this.tools.get(name);
    if (!tool) {
      this.log.warn(`Model called non-existent tool: ${name}`);
      return { ok: false, content: `Error: tool "${name}" not found.` };
    }

    let args = {};
    if (rawArgs) {
      try {
        args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
      } catch (err) {
        return { ok: false, content: `Error: invalid JSON in arguments (${err.message}).` };
      }
    }

    this.log.info(`Calling tool: ${name}(${JSON.stringify(args)})`);
    try {
      const result = await tool.execute(args, context);
      return { ok: true, ...normalizeResult(result) };
    } catch (err) {
      this.log.error(`Tool ${name} failed: ${err.message}`);
      return { ok: false, content: `Execution error in ${name}: ${err.message}` };
    }
  }
}

function normalizeResult(result) {
  if (result == null) return { content: 'OK' };
  if (typeof result === 'string') return { content: result };
  if (result.type === 'image') return { content: result.note ?? 'Screenshot taken.', image: result.base64 };
  return { content: JSON.stringify(result) };
}

module.exports = { ToolRegistry };
