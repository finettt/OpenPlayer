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
    for (const event of batch) {
      this.session.push({ role: 'user', content: event.content });
    }

    if (this.session.needsCompaction()) {
      await this.session.compact((prompt) => this.llm.complete(prompt));
    }

    let iterations = 0;
    while (iterations < this.config.agent.maxIterations) {
      iterations++;
      this.log.info(`Reasoning step ${iterations}/${this.config.agent.maxIterations}`);

      let responseMessage;
      try {
        responseMessage = await this.llm.chat({
          messages: this.session.getContext(),
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

      if (toolCalls.length === 0) {
        if (responseMessage.content?.trim()) {
          this.log.warn('Model responded with text without send_message — intercepting');
          await this.toolContext.sendChat(responseMessage.content);
        }
        return;
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
        }
      }

      if (isFinal) return;
    }

    this.log.warn('Iteration limit reached, run terminated');
    this.session.push({
      role: 'user',
      content: '[SYSTEM]: Step limit reached. Briefly respond to the player via send_message.',
    });
    try {
      const finalMsg = await this.llm.chat({
        messages: this.session.getContext(),
        tools: this.registry.getSchemas(),
        toolChoice: { type: 'function', function: { name: 'send_message' } },
      });
      this.session.push(finalMsg);
      for (const tc of finalMsg.tool_calls ?? []) {
        const result = await this.registry.execute(
          tc.function?.name, tc.function?.arguments, this.toolContext
        );
        this.session.push({
          role: 'tool', tool_call_id: tc.id, name: tc.function?.name, content: result.content,
        });
      }
    } catch (err) {
      this.log.error(`Failed to finalize run: ${err.message}`);
    }
  }
}

module.exports = { Agent };
