import { yen } from '../../util/money.js';

/**
 * レシート内容をプレーンテキスト（等幅）に整形する。
 * シミュレータはこれをそのままコンソール出力し、
 * ESC/POS プリンタはこの各行を印字する。
 */
export function renderReceiptText(r, width = 32) {
  const line = (l = '-') => l.repeat(width);
  const center = (s) => {
    const pad = Math.max(0, Math.floor((width - visualLen(s)) / 2));
    return ' '.repeat(pad) + s;
  };
  const lr = (l, right) => {
    const space = Math.max(1, width - visualLen(l) - visualLen(right));
    return l + ' '.repeat(space) + right;
  };

  const out = [];
  out.push(center(r.clinicName));
  out.push(center('領収書'));
  out.push(line());
  if (r.patientName) out.push(`患者 : ${r.patientName} 様`);
  if (r.billNo) out.push(`伝票 : ${r.billNo}`);
  out.push(`日時 : ${r.datetime}`);
  out.push(line());
  out.push(lr('お会計', yen(r.amount)));
  const methodLabel = {
    cash: '現金',
    cashless: `キャッシュレス(${r.terminalModel ?? ''})`.replace('()', ''),
    qr: r.qrLabel ?? 'QR決済',
  }[r.method] ?? r.method;
  out.push(lr('お支払方法', methodLabel));
  if (r.method === 'cash') {
    out.push(lr('お預り', yen(r.deposited)));
    out.push(lr('お釣り', yen(r.change)));
  }
  out.push(line());
  out.push(center('ありがとうございました'));
  out.push('');
  out.push('');
  return out.join('\n');
}

// 全角を2幅として概算する
function visualLen(s) {
  let n = 0;
  for (const ch of String(s)) {
    n += /[\x00-\x7F]/.test(ch) ? 1 : 2;
  }
  return n;
}
