/**
 * レシートプリンタ抽象基底クラス。
 * 会計ロジックは printReceipt(receipt) だけを呼ぶ。
 */
export class Printer {
  constructor(config, logger) {
    this.config = config;
    this.log = logger;
    this.online = false;
  }
  async connect() {}
  async disconnect() {}
  async printReceipt(_receipt) {
    throw new Error('not implemented: printReceipt');
  }
  snapshot() {
    return { online: this.online };
  }
}
