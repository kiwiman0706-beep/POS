import { CashlessTerminal } from './CashlessTerminal.js';

/**
 * ハード不要のキャッシュレス端末シミュレータ。
 * requestPayment(amount) で「決済受付中」になり、
 *   - simulateApprovalMs 経過で自動承認（無操作で完了する自動連携の動作確認）
 *   - デモボタン approve()/decline() で手動に結果を出すことも可能
 * 実機ドライバと同じイベント/メソッドを持つ。
 */
export class SimulatorCashlessTerminal extends CashlessTerminal {
  constructor(config, logger) {
    super(config, logger);
    this._timer = null;
    this._seq = 0;
  }

  async connect() {
    this.online = true;
    this.error = null;
    this.log.info('シミュレータ決済端末に接続しました（ハード無し）');
    this._emitStatus();
  }

  async requestPayment(amount) {
    if (this.busy) return;
    this.busy = true;
    this._amount = amount;
    this.emit('started', { amount });
    this._emitStatus();
    this.log.info(`決済要求（シミュレータ）: ${amount} 円`);

    const ms = this.config.link?.simulateApprovalMs ?? 2500;
    if (ms > 0) {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this.approve(), ms);
    }
  }

  /** デモ/自動: 承認を返す */
  approve() {
    if (!this.busy) return;
    clearTimeout(this._timer);
    this.busy = false;
    this._seq += 1;
    const approvalNo = String(100000 + this._seq).padStart(6, '0');
    this.emit('approved', {
      amount: this._amount,
      approvalNo,
      brand: 'DEMO',
      method: 'クレジット',
    });
    this._emitStatus();
  }

  /** デモ: 否認を返す */
  decline(reason = 'カードが読み取れませんでした') {
    if (!this.busy) return;
    clearTimeout(this._timer);
    this.busy = false;
    this.emit('declined', { reason });
    this._emitStatus();
  }

  async cancelPayment() {
    if (!this.busy) return;
    clearTimeout(this._timer);
    this.busy = false;
    this.emit('canceled', {});
    this._emitStatus();
  }
}
