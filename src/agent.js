'use strict';

class Agent {
  constructor({ config, logger, llm, session, registry, queue, toolContext }) {
    this.config = config;
    this.log = logger;
    this.llm = llm;
    this.session = session;
    this.registry = registry;
    this.queue = queue;
    this.toolContext = toolContext;

    this.queue.setHandler((batch) => this.run(batch));
  }

  async run(batch) {
    const batchSummary = batch.map((event, index) => ({
      index: index + 1,
      type: event.type,
      source: event.source ?? 'unknown',
      content: String(event.content).slice(0, 160),
    }));
    this.log.info(`Run started: ${JSON.stringify(batchSummary)}`);

    for (const event of batch) {
      this.session.push({ role: 'user', content: event.content });
    }

    const ac = this.queue.createAbortController();
    const maxSteps = 40; // hard cap: a run that never calls end_loop must die eventually
    let steps = 0;

    try {
      while (true) {
        if (ac.signal.aborted) {
          this.log.info('Run interrupted by steer message');
          return;
        }

        if (++steps > maxSteps) {
          // Segment reset rather than hard stop: while the todo list is
          // active AND making progress, start a fresh run automatically.
          // Only truly stall out (ask the player) after repeated segments
          // with no change in todo status.
          const snapshot = JSON.stringify((this.session.todos ?? []).map((t) => [t.id, t.status]));
          const progressed = snapshot !== this._lastTodosSnapshot;
          this._lastTodosSnapshot = snapshot;
          const todosActive = (this.session.todos ?? []).some((t) => t.status !== 'completed');
          this._stalledSegments = progressed ? 0 : (this._stalledSegments ?? 0) + 1;

          if (todosActive && (progressed || this._stalledSegments < 3)) {
            this.log.info(
              `Reasoning loop hit ${maxSteps} steps — auto-continuing ` +
              `(todos ${progressed ? 'progressing' : `stalled ×${this._stalledSegments}`})`
            );
            this.queue.push({
              type: 'event',
              source: 'step_limit',
              content:
                `[SYSTEM]: You reached the per-run thinking limit (${maxSteps} steps). ` +
                'Your todo list is NOT finished. Do NOT greet or chat — just CONTINUE your current task. ' +
                'Prefer batching independent tool calls, and never repeat an action that returned an error.',
            });
            return;
          }

          this.log.warn(`Reasoning loop hit ${maxSteps} steps — force-ending run`);
          try {
            await this.toolContext.sendChat('I hit my per-task thinking limit and am stopping. Give me a new instruction to continue.');
          } catch { /* chat may also be unavailable */ }
          return;
        }

        this.log.info('Reasoning step');

        let responseMessage;
        try {
          responseMessage = await this.llm.chat({
            messages: this.session.getContext({ bot: this.toolContext.bot }),
            tools: this.registry.getSchemas(),
            signal: ac.signal,
          });
        } catch (err) {
          if (err.name === 'AbortError') {
            this.log.info('Run interrupted by steer message (LLM aborted)');
            return;
          }
          this.log.error(`LLM unavailable: ${err.message}`);
          try {
            await this.toolContext.sendChat('Sorry, my brain is temporarily unavailable. Try again later.');
          } catch { /* chat may also be unavailable */ }
          return;
        }

        if (ac.signal.aborted) {
          this.log.info('Run interrupted by steer message after LLM call');
          return;
        }

        this.session.push(responseMessage);

        const toolCalls = responseMessage.tool_calls ?? [];
        this.log.info(
          `Model returned ${toolCalls.length} tool call(s): ${
            toolCalls.map((toolCall) => toolCall.function?.name ?? 'unknown').join(', ') || 'none'
          }`
        );

        if (toolCalls.length === 0) {
          this.log.warn('Model responded with plain text instead of using tools — sending reminder');
          this.session.push({
            role: 'user',
            content:
              '[SYSTEM]: You MUST use tools to interact. Use send_message to talk to the player. ' +
              'Use end_loop when you are done. Do NOT respond with plain text.',
          });
          continue;
        }

        let isFinal = false;
        for (const toolCall of toolCalls) {
          if (ac.signal.aborted) {
            this.log.info('Run interrupted by steer message during tool execution');
            return;
          }

          const name = toolCall.function?.name;
          const result = await this.registry.execute(
            name,
            toolCall.function?.arguments,
            this.toolContext
          );

          this.session.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name,
            content: result.content,
          });

          if (result.image) {
            this.session.push({
              role: 'user',
              content: [
                { type: 'text', text: '[SYSTEM]: Photo from your camera:' },
                {
                  type: 'image_url',
                  image_url: { url: `data:image/jpeg;base64,${result.image}` },
                },
              ],
            });
            this.log.info('Screenshot loaded into model context');
          }

          if (result.ok && this.registry.tools.get(name)?.final) {
            isFinal = true;
            this.log.info(`Final tool ${name} completed; ending current run`);
          }
        }

        if (isFinal) return;
      }
    } finally {
      this.queue.disposeAbortController();
    }
  }
}

module.exports = { Agent };
