/**
 * 依存ゼロの Code39 バーコード生成（SVG文字列を返す）。
 *
 * 用途：会計金額を画面にバーコード表示し、UA-P10NA 等の決済端末に
 * 「バーコードで金額入力」させることで、スタッフの手打ちを無くす。
 * （端末がバーコード金額入力に対応している場合。契約・連携登録は不要。）
 *
 * Code39 を採用（1文字が独立パターン＝実装が堅牢、チェックディジット不要、
 * 一般的なスキャナ/決済端末で広く読める）。数字のみで十分なので数字＋開始/終了記号を実装。
 */

// 各文字の9エレメント（B S B S B S B S B）。1=太, 0=細。
const PATTERNS = {
  '0': '000110100',
  '1': '100100001',
  '2': '001100001',
  '3': '101100000',
  '4': '000110001',
  '5': '100110000',
  '6': '001110000',
  '7': '000100101',
  '8': '100100100',
  '9': '001100100',
  '*': '010010100', // 開始/終了
};

/**
 * @param {string} value  数字文字列（例 "2500"）
 * @param {object} opt    { narrow, wide, height, quiet }（px）
 * @returns {string} SVG
 */
export function code39Svg(value, opt = {}) {
  const narrow = opt.narrow ?? 2;
  const wide = opt.wide ?? 6;
  const height = opt.height ?? 90;
  const quiet = opt.quiet ?? 16; // クワイエットゾーン

  const chars = ('*' + String(value).replace(/[^0-9]/g, '') + '*').split('');
  let x = quiet;
  const rects = [];

  for (let ci = 0; ci < chars.length; ci++) {
    const pat = PATTERNS[chars[ci]];
    if (!pat) continue;
    for (let i = 0; i < 9; i++) {
      const w = pat[i] === '1' ? wide : narrow;
      const isBar = i % 2 === 0; // 偶数=バー(黒), 奇数=スペース(白)
      if (isBar) {
        rects.push(`<rect x="${x}" y="0" width="${w}" height="${height}" />`);
      }
      x += w;
    }
    x += narrow; // 文字間ギャップ（細スペース）
  }

  const totalW = x + quiet - narrow;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${height}" ` +
    `viewBox="0 0 ${totalW} ${height}" role="img" aria-label="金額バーコード ${value}">` +
    `<rect x="0" y="0" width="${totalW}" height="${height}" fill="#fff"/>` +
    `<g fill="#000">${rects.join('')}</g>` +
    `</svg>`
  );
}
