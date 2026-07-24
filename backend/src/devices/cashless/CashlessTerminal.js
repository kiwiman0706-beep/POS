import { EventEmitter } from 'node:events';

/**
 * キャッシュレス決済端末ドライバの抽象基底クラス（UA-P10NA 等）。
 *
 * 会計ステートマシンはこのI/Fにしか依存しない。半連動（手動確認）から
 * 金額連動（自動）へは、config を切り替えて実装を差し替えるだけ。
 *
 * ---- ライフサイクル ----
 *   connect() / disconnect()
 *   requestPayment(amount) … 端末へ金額を送信し決済開始（連動モード）
 *   cancelPayment()        … 進行中の取引を中止
 *
 * ---- emit するイベント ----
 *   'status'   {online:boolean, error:string|null, busy:boolean}
 *   'started'  {amount}                              決済受付が始まった
 *   'approved' {amount, approvalNo, brand, method}   承認完了
 *   'declined' {reason}                              否認
 *   'canceled' {}                                    取消完了
 *   'error'    {code, message}
 *
 * ※本ソフトはカード番号等の機微情報を一切保持しない。端末から受け取るのは
 *   承認可否・伝票番号（approvalNo）・ブランド名など、レシートに出す範囲のみ。
 */
export class CashlessTerminal extends EventEmitter {
  constructor(config, logger) {
    super();
    this.config = config;
    this.log = logger;
    this.online = false;
    this.error = null;
    this.busy = false;
  }

  async connect() {
    throw new Error('not implemented: connect');
  }
  async disconnect() {}
  async requestPayment(_amount) {
    throw new Error('not implemented: requestPayment');
  }
  async cancelPayment() {
    throw new Error('not implemented: cancelPayment');
  }

  snapshot() {
    return { online: this.online, error: this.error, busy: this.busy };
  }

  _emitStatus() {
    this.emit('status', {
      online: this.online,
      error: this.error,
      busy: this.busy,
    });
  }
}
