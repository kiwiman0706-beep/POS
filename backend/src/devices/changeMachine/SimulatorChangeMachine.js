import { ChangeMachine } from './ChangeMachine.js';
import { planPayout, sumBreakdown } from '../../util/money.js';

/**
 * ハード不要の釣銭機シミュレータ。
 * insert(denom) を呼ぶと投入をエミュレートする（フロントのデモ用ボタンから叩く）。
 * 実機ドライバと完全に同じイベント/メソッドを持つので、動作検証や
 * デモ、レセコン連携部分の開発を実機なしで進められる。
 */
export class SimulatorChangeMachine extends ChangeMachine {
  constructor(config, logger, denominations) {
    super(config, logger);
    this.denominations = denominations;
    this.deposited = 0;
    this.accepting = false;
  }

  async connect() {
    this.inventory = { ...(this.config.initialInventory ?? {}) };
    this.online = true;
    this.error = null;
    this.log.info('シミュレータ釣銭機に接続しました（ハード無し）');
    this._emitStatus();
  }

  async beginDeposit(_amount) {
    this.deposited = 0;
    this.accepting = true;
    this.busy = true;
    this.log.info('入金受付を開始（シミュレータ）');
    this.emit('deposit', { deposited: 0 });
  }

  /** デモ用: 指定金種を1枚投入する */
  insert(denom) {
    if (!this.accepting) return;
    this.deposited += Number(denom);
    // 投入された現金は在庫に加算（釣銭原資になる）
    this.inventory[String(denom)] = (this.inventory[String(denom)] ?? 0) + 1;
    this.emit('deposit', { deposited: this.deposited });
    this._emitStatus();
  }

  async settle(amount) {
    if (!this.accepting) throw new Error('入金受付中ではありません');
    this.accepting = false;
    const change = this.deposited - amount;

    if (change < 0) {
      // 不足。受付を戻す（実機なら追加投入待ちにするが、ここでは簡易にエラー）
      this.accepting = true;
      this.emit('error', { code: 'SHORT', message: '投入額が不足しています' });
      return;
    }

    if (change === 0) {
      this.busy = false;
      this.emit('dispensed', { change: 0, breakdown: {} });
      return;
    }

    const plan = planPayout(change, this.denominations, this.inventory);
    if (!plan.ok) {
      this.error = `釣銭不足: あと ${plan.shortfall} 円分の金種が足りません`;
      this.emit('error', { code: 'NO_CHANGE', message: this.error });
      this._emitStatus();
      return;
    }

    // 在庫から払い出し
    for (const [d, n] of Object.entries(plan.breakdown)) {
      this.inventory[d] = (this.inventory[d] ?? 0) - n;
    }
    this.busy = false;
    this.log.info(`釣銭 ${sumBreakdown(plan.breakdown)} 円を払い出し`, plan.breakdown);
    this.emit('dispensed', { change, breakdown: plan.breakdown });
    this._emitStatus();
  }

  async refund() {
    this.accepting = false;
    const returned = this.deposited;
    // 投入で在庫加算した分を戻す（簡易）
    this.deposited = 0;
    this.busy = false;
    this.emit('refunded', { returned });
    this._emitStatus();
  }
}
