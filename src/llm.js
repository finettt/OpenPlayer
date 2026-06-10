'use strict';

const { OpenAI } = require('openai');

class LLMClient {
  constructor(config, logger) {
    this.config = config.llm;
    this.log = logger;
    this.client = new OpenAI({
      baseURL: this.config.baseURL,
      apiKey: this.config.apiKey,
      timeout: this.config.requestTimeoutMs,
    });
  }

  async chat({ messages, tools, toolChoice = 'auto' }) {
    let lastError;

    for (const model of this.config.models) {
      for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
        try {
          const response = await this.client.chat.completions.create({
            model,
            messages,
            ...(tools ? { tools, tool_choice: toolChoice } : {}),
            temperature: this.config.temperature,
          });
          const choice = response.choices?.[0];
          if (!choice?.message) throw new Error('Empty response from model');
          return choice.message;
        } catch (err) {
          lastError = err;
          const delay = Math.min(1000 * 2 ** (attempt - 1), 15_000);
          this.log.warn(
            `Model ${model}, attempt ${attempt}/${this.config.maxRetries} failed: ${err.message}. ` +
            (attempt < this.config.maxRetries ? `Retrying in ${delay}ms` : 'Moving to next model')
          );
          if (attempt < this.config.maxRetries) {
            await new Promise((r) => setTimeout(r, delay));
          }
        }
      }
    }

    throw new Error(`All models unavailable. Last error: ${lastError?.message}`);
  }

  async complete(prompt) {
    const msg = await this.chat({
      messages: [{ role: 'user', content: prompt }],
    });
    return msg.content ?? '';
  }
}

module.exports = { LLMClient };
