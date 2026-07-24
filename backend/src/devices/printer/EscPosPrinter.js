import net from 'node:net';
import { Printer } from './Printer.js';
import { renderReceiptText } from './receiptLayout.js';

/**
 * ESC/POS レシートプリンタドライバ（EPSON TM系 等、実例多数）。
 * driver: 'escpos-network'（LAN, ポート9100）/ 'escpos-serial'（USBシリアル）
 *
 * 日本語印字はプリンタのコードページ（Shift_JIS）に依存する。
 * ここでは代表的な初期化＋Shift_JISエンコードで実装。実機の機種により
 * 調整が要る場合があるが、renderReceiptText の出力を流し込む構造は共通。
 */
export class EscPosPrinter extends Printer {
  constructor(config, logger, mode) {
    super(config, logger);
    this.mode = mode; // 'network' | 'serial'
    this.port = null;
    this.socket = null;
  }

  async connect() {
    if (this.mode === 'serial') {
      const { SerialPort } = await import('serialport');
      this.port = new SerialPort({
        path: this.config.serial.path,
        baudRate: this.config.serial.baudRate ?? 38400,
        autoOpen: false,
      });
      await new Promise((res, rej) =>
        this.port.open((e) => (e ? rej(e) : res()))
      );
    }
    this.online = true;
    this.log.info(`ESC/POSプリンタ接続 (${this.mode})`);
  }

  async _write(buf) {
    if (this.mode === 'serial') {
      return new Promise((res, rej) =>
        this.port.write(buf, (e) => (e ? rej(e) : res()))
      );
    }
    // network: 接続の都度書き込んで閉じる
    const { host, port } = this.config.network;
    return new Promise((res, rej) => {
      const sock = net.createConnection({ host, port }, () => {
        sock.write(buf, () => sock.end());
      });
      sock.on('error', rej);
      sock.on('close', () => res());
    });
  }

  async printReceipt(receipt) {
    const text = renderReceiptText(receipt);
    const ESC = 0x1b, GS = 0x1d;
    const init = Buffer.from([ESC, 0x40]); // 初期化
    // 印字言語切替（日本語）: 実機により要調整
    const body = encodeShiftJis(text + '\n');
    const cut = Buffer.from([GS, 0x56, 0x00]); // フルカット
    await this._write(Buffer.concat([init, body, cut]));
    return { ok: true };
  }
}

/**
 * 最小限の Shift_JIS エンコーダ。ASCII はそのまま、
 * 非ASCIIは Node 標準では変換できないため、実運用では
 * iconv-lite 等を導入して置き換えることを推奨（ここでは '?' にフォールバック）。
 */
function encodeShiftJis(str) {
  const bytes = [];
  for (const ch of str) {
    const code = ch.codePointAt(0);
    if (code < 0x80) bytes.push(code);
    else bytes.push(0x3f); // '?' フォールバック（→ iconv-lite 推奨）
  }
  return Buffer.from(bytes);
}
