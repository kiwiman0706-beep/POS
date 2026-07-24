import { EventEmitter } from 'node:events';
import { parseBill } from '../receipt/billParser.js';
import { yen } from '../util/money.js';

/**
 * 会計セッションのステートマシン（1会計＝1インスタンス相当だが、
 * ここでは1台のレジに1つの現在セッションを持つ形で常駐させ、reset で作り直す）。
 *
 * フェーズ遷移:
 *   IDLE
 *    └(setBill)→ BILL_READY  … 金額確定（スキャン/手入力）
 *        └(selectMethod)→
 *            cash     → CASH_DEPOSIT →(settle)→ CASH_DISPENSE →(dispensed)→ PRINTING → COMPLETE
 *            cashless → CASHLESS_WAIT →(confirm)→ PRINTING → COMPLETE
 *            qr       → QR_WAIT       →(confirm)→ PRINTING → COMPLETE
 *   いずれも (cancel) で IDLE へ（現金は返却）。COMPLETE から (reset/自動) で IDLE。
 */
export class CheckoutSession extends EventEmitter {
  constructor({ config, changeMachine, printer }) {
    super();
    this.config = config;
    this.cm = changeMachine;
    this.printer = printer;
    this._wireDevices();
    this._reset();
  }

  _wireDevices() {
    this.cm.on('deposit', ({ deposited }) => {
      if (this.state.phase === 'CASH_DEPOSIT') {
        this.state.cash.deposited = deposited;
        this._touch();
      }
    });
    this.cm.on('dispensed', ({ change, breakdown }) => {
      if (this.state.phase === 'CASH_DISPENSE') {
        this.state.cash.change = change;
        this.state.cash.breakdown = breakdown;
        this.state.cash.dispensed = true;
        this._afterPaid();
      }
    });
    this.cm.on('refunded', ({ returned }) => {
      this._info(`投入金 ${yen(returned)} を返却しました`);
    });
    this.cm.on('error', ({ message }) => {
      this.state.phase = 'ERROR';
      this.state.message = message;
      this._touch();
    });
  }

  _reset() {
    this.state = {
      phase: 'IDLE',
      bill: null, // {amount, patientName, billNo, source}
      method: null, // 'cash'|'cashless'|'qr'
      cash: { deposited: 0, change: 0, breakdown: {}, dispensed: false },
      message: 'ご希望の手続きのボタンを押してください',
      receipt: null,
      updatedAt: Date.now(),
    };
  }

  snapshot() {
    return { ...this.state, config: this._publicConfig() };
  }

  _publicConfig() {
    return {
      clinicName: this.config.clinicName,
      denominations: this.config.currency.denominations,
      cashless: this.config.cashless,
      qr: this.config.qr,
      simulate: this.config.changeMachine.driver === 'simulator',
      languages: this.config.ui.languages,
      defaultLanguage: this.config.ui.defaultLanguage,
    };
  }

  _touch() {
    this.state.updatedAt = Date.now();
    this.emit('state', this.snapshot());
  }

  _info(message) {
    this.emit('toast', { level: 'info', message });
  }

  // ---------------- コマンド（WSから呼ばれる） ----------------

  /** スタッフ: 金額確定（スキャン or 手入力）。raw は生文字列 */
  setBill(raw, source = 'scan') {
    if (!['IDLE', 'BILL_READY'].includes(this.state.phase)) {
      this._info('会計処理中です。完了後にやり直してください');
      return;
    }
    const parsed = parseBill(raw, this.config.recept?.barcode?.parser);
    if (!parsed.ok) {
      this._info(parsed.error ?? '読み取りに失敗しました');
      return;
    }
    this.state.bill = {
      amount: parsed.amount,
      patientName: parsed.patientName ?? null,
      billNo: parsed.billNo ?? null,
      source,
    };
    this.state.phase = 'BILL_READY';
    this.state.message = `お会計 ${yen(parsed.amount)} です。お支払方法をお選びください`;
    this._touch();
  }

  /** 支払方法選択 */
  selectMethod(method) {
    if (this.state.phase !== 'BILL_READY') {
      this._info('先に金額を確定してください');
      return;
    }
    this.state.method = method;
    if (method === 'cash') {
      this.state.phase = 'CASH_DEPOSIT';
      this.state.cash = { deposited: 0, change: 0, breakdown: {}, dispensed: false };
      this.state.message = '現金を投入してください';
      this._touch();
      this.cm.beginDeposit(this.state.bill.amount);
    } else if (method === 'cashless') {
      this.state.phase = 'CASHLESS_WAIT';
      this.state.message = `${this.config.cashless.terminalModel} でお支払いください`;
      this._touch();
    } else if (method === 'qr') {
      this.state.phase = 'QR_WAIT';
      this.state.message = `${this.config.qr.label} のQRを読み取ってお支払いください`;
      this._touch();
    }
  }

  /** 現金: 患者が「支払う」を押した → 受付停止＋釣銭払出 */
  settleCash() {
    if (this.state.phase !== 'CASH_DEPOSIT') return;
    const amount = this.state.bill.amount;
    if (this.state.cash.deposited < amount) {
      this._info(
        `あと ${yen(amount - this.state.cash.deposited)} 投入してください`
      );
      return;
    }
    this.state.phase = 'CASH_DISPENSE';
    this.state.message = 'お釣りをお受け取りください';
    this._touch();
    this.cm.settle(amount);
  }

  /** キャッシュレス: スタッフが端末承認を確認 */
  confirmCashless() {
    if (this.state.phase !== 'CASHLESS_WAIT') return;
    this._afterPaid();
  }

  /** QR: スタッフが着金確認 */
  confirmQr() {
    if (this.state.phase !== 'QR_WAIT') return;
    this._afterPaid();
  }

  /** 取消（現金は返却） */
  cancel() {
    if (['CASH_DEPOSIT', 'CASH_DISPENSE'].includes(this.state.phase)) {
      this.cm.refund();
    }
    this._reset();
    this._info('会計を取り消しました');
    this._touch();
  }

  /** 完了後に次の会計へ */
  reset() {
    this._reset();
    this._touch();
  }

  // ---------------- 内部 ----------------

  async _afterPaid() {
    this.state.phase = 'PRINTING';
    this.state.message = 'レシートを印刷しています';
    this._touch();

    const b = this.state.bill;
    const receipt = {
      clinicName: this.config.clinicName,
      datetime: new Date().toLocaleString('ja-JP'),
      patientName: b.patientName,
      billNo: b.billNo,
      amount: b.amount,
      method: this.state.method,
      deposited: this.state.cash.deposited,
      change: this.state.cash.change,
      terminalModel: this.config.cashless.terminalModel,
      qrLabel: this.config.qr.label,
    };
    this.state.receipt = receipt;

    try {
      await this.printer.printReceipt(receipt);
    } catch (e) {
      this._info('レシート印刷に失敗しました（会計は完了扱い）');
    }

    this.state.phase = 'COMPLETE';
    this.state.message = 'お大事にどうぞ。ありがとうございました';
    this._touch();

    // 一定時間後に自動で次の会計へ
    const sec = this.config.ui.autoReturnSeconds ?? 20;
    clearTimeout(this._autoTimer);
    this._autoTimer = setTimeout(() => this.reset(), sec * 1000);
  }
}
