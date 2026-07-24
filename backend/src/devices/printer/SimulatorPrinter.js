import { Printer } from './Printer.js';
import { renderReceiptText } from './receiptLayout.js';

/** コンソールにレシートを出力するシミュレータ。ハード不要。 */
export class SimulatorPrinter extends Printer {
  async connect() {
    this.online = true;
    this.log.info('シミュレータプリンタに接続しました（コンソール出力）');
  }

  async printReceipt(receipt) {
    const text = renderReceiptText(receipt);
    this.log.info('レシート印字（シミュレータ）:\n' + boxed(text));
    return { ok: true };
  }
}

function boxed(text) {
  const top = '   ┌' + '─'.repeat(34) + '┐';
  const bot = '   └' + '─'.repeat(34) + '┘';
  const body = text
    .split('\n')
    .map((l) => '   │ ' + l.padEnd(32, ' ') + ' │')
    .join('\n');
  return [top, body, bot].join('\n');
}
