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

    while (true) {
      this.log.info('Reasoning step');

      let responseMessage;
      try {
        responseMessage = await this.llm.chat({
          messages: this.session.getContext({ bot: this.toolContext.bot }),
          tools: this.registry.getSchemas(),
        });
      } catch (err) {
        this.log.error(`LLM unavailable: ${err.message}`);
        try {
          await this.toolContext.sendChat('Sorry, my brain is temporarily unavailable. Try again later.');
        } catch { /* chat may also be unavailable */ }
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
  }
}

module.exports = { Agent };
