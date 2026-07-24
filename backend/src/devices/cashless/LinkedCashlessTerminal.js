import net from 'node:net';
import { CashlessTerminal } from './CashlessTerminal.js';

/**
 * 金額連動（自動）キャッシュレス端末ドライバ【骨組み】。
 * UA-P10NA 等の「上位（POS）連携インターフェース」経由で、
 * POSから金額を送信 → 端末で決済 → 承認/否認を受信する。
 *
 * ⚠️ 正直な注記（釣銭機と同じ考え方）:
 *   端末の連携プロトコル（電文仕様）は決済端末ベンダー/決済会社のNDA資料であり、
 *   確定した電文を本リポジトリに載せることはできません。ここには接続と電文の
 *   送受信の「枠」だけを用意し、実際の電文は PROTOCOL / buildRequest / parse に
 *   「後差し込み」する構造にしています。上位（会計ロジック・UI）は無改修で実機化できます。
 *
 *   → docs/キャッシュレス連携.md に差し込み手順をまとめています。
 *
 * transport:
 *   'linked-tcp'    … 端末（または連携アプリ）とTCPソケットで接続
 *   'linked-serial' … RS-232C / USBシリアルで接続
 */

// ---- 電文定義（★実機の連携仕様書の値で置き換える）----
const PROTOCOL = {
  // 例: 決済要求電文のヘッダ・取引種別（売上=..）・金額フィールド長 など
  SALE_REQUEST: null,
  CANCEL_REQUEST: null,
  // レスポンス解析用のキー（承認/否認の判定位置、伝票番号・ブランドの取り出し位置）
  RESP: null,
};

export class LinkedCashlessTerminal extends CashlessTerminal {
  constructor(config, logger, transport) {
    super(config, logger);
    this.transport = transport; // 'linked-tcp' | 'linked-serial'
    this.sock = null;
    this.port = null;
    this._buf = Buffer.alloc(0);
  }

  async connect() {
    if (this.transport === 'linked-serial') {
      let SerialPort;
      try {
        ({ SerialPort } = await import('serialport'));
      } catch {
        throw new Error(
          "連動(シリアル)には 'serialport' が必要です。`npm install serialport` を実行してください。"
        );
      }
      const s = this.config.link.serial;
      this.port = new SerialPort({
        path: s.path,
        baudRate: s.baudRate ?? 9600,
        dataBits: s.dataBits ?? 8,
        parity: s.parity ?? 'none',
        stopBits: s.stopBits ?? 1,
        autoOpen: false,
      });
      await new Promise((res, rej) =>
        this.port.open((e) => (e ? rej(e) : res()))
      );
      this.port.on('data', (d) => this._onData(d));
      this.port.on('error', (e) =>
        this.emit('error', { code: 'SERIAL', message: String(e) })
      );
    } else {
      // linked-tcp: 常時接続を張る
      const { host, port } = this.config.link.network;
      await new Promise((res, rej) => {
        this.sock = net.createConnection({ host, port }, res);
        this.sock.on('error', (e) => {
          this.emit('error', { code: 'TCP', message: String(e) });
          rej(e);
        });
        this.sock.on('data', (d) => this._onData(d));
      });
    }
    this.online = true;
    this.error = null;
    this.log.info(`キャッシュレス端末に接続（${this.transport}）`);
    this._emitStatus();
  }

  async disconnect() {
    if (this.port?.isOpen) await new Promise((r) => this.port.close(r));
    if (this.sock) this.sock.destroy();
    this.online = false;
  }

  async requestPayment(amount) {
    this.busy = true;
    this._amount = amount;
    this.emit('started', { amount });
    this._emitStatus();
    this._send(this._buildRequest(amount));
    // 承認/否認は端末からの応答電文を _onData → parse して emit する
  }

  async cancelPayment() {
    this._send(PROTOCOL.CANCEL_REQUEST);
    // 実機の取消応答を受けて 'canceled' を emit する
  }

  // ---- 送受信 ----
  _send(payload) {
    if (!payload) {
      this.log.warn(
        'PROTOCOL 未定義の電文を送信しようとしました（連携仕様書の値を差し込んでください）'
      );
      return;
    }
    const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    this.log.debug('TX', buf);
    if (this.transport === 'linked-serial') this.port?.write(buf);
    else this.sock?.write(buf);
  }

  _buildRequest(amount) {
    // ★実仕様: 売上要求電文＋金額（BCD/ASCII等）を組み立てる
    if (!PROTOCOL.SALE_REQUEST) return null;
    // 例: return Buffer.concat([PROTOCOL.SALE_REQUEST, encodeAmount(amount)]);
    return PROTOCOL.SALE_REQUEST;
  }

  _onData(chunk) {
    this._buf = Buffer.concat([this._buf, chunk]);
    this.log.debug('RX', chunk);
    // ★実仕様: this._buf からフレームを切り出し、種別に応じて emit する。
    //   承認 → this.emit('approved', { amount, approvalNo, brand, method })
    //   否認 → this.emit('declined', { reason })
    //   取消 → this.emit('canceled', {})
    //   その後 this.busy = false; this._emitStatus();
    //
    // 連携仕様が未反映の間はここで解釈できないため、実機導入時に実装する。
  }
}

export const _internals = { PROTOCOL };
