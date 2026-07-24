import { EventEmitter } from 'node:events';

/**
 * 自動釣銭機ドライバの抽象基底クラス。
 *
 * 上位アプリ（会計ステートマシン）はこのI/Fにしか依存しない。
 * 実機（Glory RT-300/RTN-300 等）でもシミュレータでも、
 * このクラスを継承して同じイベント/メソッドを備えれば差し替え可能。
 *
 * ---- ライフサイクル ----
 *   connect() → 使用可能に。以後 status イベントで online/inventory を通知。
 *   beginDeposit(amount) → 入金受付開始。硬貨/紙幣投入のたび 'deposit' を emit。
 *   settle(amount)       → 受付停止し、釣銭(投入額-amount)を払い出す。→ 'dispensed'
 *   refund()             → 受付中の投入金を全額返却する。→ 'refunded'
 *   disconnect()
 *
 * ---- emit するイベント ----
 *   'status'   {online:boolean, error:string|null, inventory:Object}
 *   'deposit'  {deposited:number}                 入金額が変化するたび
 *   'dispensed'{change:number, breakdown:Object}  釣銭払い出し完了
 *   'refunded' {returned:number}                  返却完了
 *   'error'    {code:string, message:string}
 */
export class ChangeMachine extends EventEmitter {
  constructor(config, logger) {
    super();
    this.config = config;
    this.log = logger;
    this.online = false;
    this.error = null;
    this.inventory = {};
    this.busy = false;
  }

  /* 以下は各ドライバで実装する */
  async connect() {
    throw new Error('not implemented: connect');
  }
  async disconnect() {}
  async beginDeposit(_amount) {
    throw new Error('not implemented: beginDeposit');
  }
  async settle(_amount) {
    throw new Error('not implemented: settle');
  }
  async refund() {
    throw new Error('not implemented: refund');
  }

  /** 現在ステータスのスナップショット（WSでフロントに送る用） */
  snapshot() {
    return {
      online: this.online,
      error: this.error,
      inventory: this.inventory,
      busy: this.busy,
    };
  }

  _emitStatus() {
    this.emit('status', {
      online: this.online,
      error: this.error,
      inventory: this.inventory,
    });
  }
}
