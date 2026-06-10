'use strict';

const puppeteer = require('puppeteer');

class Camera {
  constructor(config, logger) {
    this.config = config.camera;
    this.log = logger;
    this.browser = null;
    this.page = null;
    this.ready = false;
  }

  async init(bot) {
    this.log.info('Starting 3D world renderer...');
    const { mineflayer: mineflayerViewer } = require('prismarine-viewer');
    mineflayerViewer(bot, {
      port: this.config.viewerPort,
      firstPerson: this.config.firstPerson,
    });

    this.browser = await puppeteer.launch({
      browser: this.config.browser,
      headless: true,
      executablePath: this.config.executablePath,
      args: this.config.args,
    });

    this.browser.on('disconnected', () => {
      this.ready = false;
      this.log.warn('Browser disconnected — camera unavailable until restart');
    });

    this.page = await this.browser.newPage();
    await this.page.setViewport({
      width: this.config.width,
      height: this.config.height,
    });
    await this.page.goto(`http://localhost:${this.config.viewerPort}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    this.ready = true;
    this.log.info('Camera connected and ready');
  }

  async screenshot() {
    if (!this.ready || !this.page) {
      throw new Error('Camera not initialized');
    }
    await new Promise((r) => setTimeout(r, this.config.settleMs));
    return this.page.screenshot({
      encoding: 'base64',
      type: 'jpeg',
      quality: this.config.jpegQuality,
    });
  }

  async close() {
    this.ready = false;
    if (this.browser) {
      try {
        await this.browser.close();
        this.log.info('Browser closed');
      } catch (err) {
        this.log.warn(`Error closing browser: ${err.message}`);
      }
      this.browser = null;
      this.page = null;
    }
  }
}

module.exports = { Camera };
