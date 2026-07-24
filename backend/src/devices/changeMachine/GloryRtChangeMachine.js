import { ChangeMachine } from './ChangeMachine.js';
import { planPayout } from '../../util/money.js';

/**
 * Glory 自動釣銭機（RT-300 / RTN-300 / RT-380 系）実機ドライバ【骨組み】。
 *
 * ⚠️ 重要（正直な注記）:
 *   Glory の「上位手順仕様書（外部インターフェース仕様）」はメーカー/販社の
 *   NDA 資料であり、公開された確定バイト列ではありません。ここには
 *   一般的なシリアル機器の枠組み（STX/本文/ETX/BCC のフレーミング、
 *   コマンド→レスポンスのやり取り）だけを用意し、実際のコマンド定義は
 *   PROTOCOL オブジェクトに「後から差し込む」構造にしています。
 *   実機導入時に入手した仕様書の値を PROTOCOL と parseFrame()/buildFrame() に
 *   反映すれば、上位アプリ（会計ロジック・UI）は一切変更せずに実機動作します。
 *
 *   → docs/釣銭機プロトコル.md に差し込み手順をまとめています。
 *
 * このドライバは ChangeMachine のI/F（connect/beginDeposit/settle/refund と
 * status/deposit/dispensed/refunded/error イベント）を満たします。
 */

// ---- フレーミング定数（一般的な値。実仕様に合わせて要確認）----
const STX = 0x02;
const ETX = 0x03;
const ENQ = 0x05;
const ACK = 0x06;
const NAK = 0x15;

// ---- コマンド定義（★実機の上位手順仕様書の値で置き換える）----
// ここは「プレースホルダ」。実値が判明したら差し替える。
const PROTOCOL = {
  // 例: 状態要求 / 入金開始 / 入金確定(釣銭払出) / 返却 …
  STATUS_REQUEST: null, // 例: Buffer.from([0x53]) 等
  DEPOSIT_START: null,
  DEPOSIT_SETTLE: null, // 金額パラメータ付きになる想定
  REFUND: null,
  // レスポンス種別の識別子など
  RESP_STATUS: null,
  RESP_DEPOSIT: null,
  RESP_DISPENSED: null,
};

function bcc(bytes) {
  // 一般的な XOR チェックサム（実仕様に合わせて要確認）
  return bytes.reduce((a, b) => a ^ b, 0);
}

export class GloryRtChangeMachine extends ChangeMachine {
  constructor(config, logger, denominations) {
    super(config, logger);
    this.denominations = denominations;
    this.port = null;
    this.parser = null;
    this._depositAmount = 0;
  }

  async connect() {
    // serialport はオプション依存。実機運用時のみ読み込む。
    let SerialPort, InterByteTimeoutParser;
    try {
      ({ SerialPort } = await import('serialport'));
      ({ InterByteTimeoutParser } = await import(
        '@serialport/parser-inter-byte-timeout'
      ));
    } catch (e) {
      throw new Error(
        "実機ドライバには 'serialport' が必要です。`npm install serialport @serialport/parser-inter-byte-timeout` を実行してください。"
      );
    }

    const s = this.config.serial;
    this.port = new SerialPort({
      path: s.path,
      baudRate: s.baudRate ?? 9600,
      dataBits: s.dataBits ?? 8,
      parity: s.parity ?? 'even',
      stopBits: s.stopBits ?? 1,
      autoOpen: false,
    });

    await new Promise((resolve, reject) => {
      this.port.open((err) => (err ? reject(err) : resolve()));
    });

    // フレーム区切り（無通信間隔で1フレームとみなす簡易パーサ）
    this.parser = this.port.pipe(
      new InterByteTimeoutParser({ interval: 30 })
    );
    this.parser.on('data', (buf) => this._onFrame(buf));
    this.port.on('error', (err) =>
      this.emit('error', { code: 'SERIAL', message: String(err) })
    );

    this.online = true;
    this.error = null;
    this.log.info(`Glory釣銭機に接続: ${s.path} @${s.baudRate}`);
    this._emitStatus();

    // 実機では起動時に状態要求を投げて inventory を取得する
    this._send(PROTOCOL.STATUS_REQUEST);
  }

  async disconnect() {
    if (this.port?.isOpen) {
      await new Promise((r) => this.port.close(r));
    }
    this.online = false;
  }

  async beginDeposit(amount) {
    this._depositAmount = amount;
    this.busy = true;
    this.emit('deposit', { deposited: 0 });
    this._send(PROTOCOL.DEPOSIT_START);
    // 実機では投入検知フレームが来るたび _onFrame() で 'deposit' を emit する
  }

  async settle(amount) {
    // 実機に「受付停止＋釣銭払出」を指示。金額パラメータを載せる想定。
    this._send(this._buildSettle(amount));
    // 払い出し完了フレーム受信で 'dispensed' を emit する
  }

  async refund() {
    this._send(PROTOCOL.REFUND);
  }

  // ---- 送信（フレーム組み立て）----
  _send(payload) {
    if (!payload) {
      this.log.warn(
        'PROTOCOL 未定義のコマンドを送信しようとしました（仕様書の値を差し込んでください）'
      );
      return;
    }
    const frame = this._buildFrame(payload);
    this.log.debug('TX', frame);
    this.port?.write(frame);
  }

  _buildFrame(payload) {
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const withEtx = Buffer.concat([Buffer.from([STX]), body, Buffer.from([ETX])]);
    const check = bcc([...body, ETX]);
    return Buffer.concat([withEtx, Buffer.from([check])]);
  }

  _buildSettle(amount) {
    // ★実仕様: 確定コマンド＋金額(BCD/バイナリ等) を組み立てる
    if (!PROTOCOL.DEPOSIT_SETTLE) return null;
    // 例: return Buffer.concat([PROTOCOL.DEPOSIT_SETTLE, encodeAmount(amount)]);
    return PROTOCOL.DEPOSIT_SETTLE;
  }

  // ---- 受信（フレーム解釈）----
  _onFrame(buf) {
    this.log.debug('RX', buf);
    // ★実仕様: フレーム種別を判定して以下を emit する。
    //   - 入金額更新   → this.emit('deposit', {deposited})
    //   - 払い出し完了 → this.emit('dispensed', {change, breakdown})
    //   - 返却完了     → this.emit('refunded', {returned})
    //   - 在庫/状態    → this.inventory 更新 + this._emitStatus()
    //   - 異常         → this.emit('error', {code, message})
    //
    // 仕様書が未反映の間はここに到達しても解釈できないため、
    // 実機導入時にこの parseFrame を実装する。
  }

  /**
   * 在庫から釣銭内訳を求めるヘルパ（払い出し可否の事前判定に利用可）。
   * 実機は自機で払い出すが、上位で在庫警告を出すために使える。
   */
  planChange(change) {
    return planPayout(change, this.denominations, this.inventory);
  }
}

export const _internals = { STX, ETX, ENQ, ACK, NAK, bcc, PROTOCOL };
