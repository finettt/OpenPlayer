'use strict';

const path = require('path');

const env = (key, fallback) => process.env[key] || fallback;

module.exports = {
  llm: {
    baseURL: env('LLM_BASE_URL', 'http://localhost:8080/v1'),
    apiKey: env('LLM_API_KEY', 'sk-null'),
    models: [
      env('LLM_MODEL', 'qwen3-8b'),
    ],
    temperature: 0.7,
    maxRetries: 3,
    requestTimeoutMs: 120_000,
  },

  bot: {
    host: env('MC_HOST', 'localhost'),
    port: parseInt(env('MC_PORT', '25565'), 10),
    username: env('MC_USERNAME', 'Agent'),
    reconnect: {
      enabled: true,
      baseDelayMs: 5_000,
      maxDelayMs: 60_000,
    },
  },

  camera: {
    viewerPort: 3000,
    width: 800,
    height: 600,
    firstPerson: true,
    jpegQuality: 80,
    settleMs: 1_500,
    browser: 'firefox',
    executablePath: env('BROWSER_PATH', 'firefox'),
    args: ['--no-sandbox', '--disable-gpu', '--ignore-certificate-errors'],
  },

  agent: {
    heartbeat: {
      enabled: env('HEARTBEAT', 'true') === 'true',
      intervalMs: 5 * 60_000,
      onlyIfPlayersNearby: true,
      nearbyRadius: 32,
    },
    chatRateLimitMs: 1_500,
    chatMaxLength: 256,
  },

  storage: {
    dir: path.join(__dirname, 'data'),
    soulFile: path.join(__dirname, 'SOUL.md'),
    toolsFile: path.join(__dirname, 'TOOLS.md'),
    transcriptFile: path.join(__dirname, 'data', 'transcript.jsonl'),
    memoryFile: path.join(__dirname, 'data', 'MEMORY.md'),
    todoFile: path.join(__dirname, 'data', 'todo.json'),
  },

  logging: {
    level: env('LOG_LEVEL', 'info'),
    redactImages: true,
  },

};
