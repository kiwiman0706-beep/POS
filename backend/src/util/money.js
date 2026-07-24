/**
 * 金種計算ユーティリティ。
 * 在庫（金種→枚数）を考慮して釣銭の払い出し内訳を求める。
 */

/**
 * greedy に釣銭内訳を計算する。在庫不足の金種はスキップして次に進む。
 * @param {number} amount   払い出したい金額
 * @param {number[]} denominations 大きい順の金種配列
 * @param {Object<string,number>} inventory 金種(文字列)→枚数
 * @returns {{ok:boolean, breakdown:Object<number,number>, shortfall:number}}
 */
export function planPayout(amount, denominations, inventory) {
  const denoms = [...denominations].sort((a, b) => b - a);
  const breakdown = {};
  let remaining = amount;

  for (const d of denoms) {
    if (remaining <= 0) break;
    const available = inventory ? (inventory[String(d)] ?? Infinity) : Infinity;
    const need = Math.floor(remaining / d);
    const use = Math.min(need, available);
    if (use > 0) {
      breakdown[d] = use;
      remaining -= use * d;
    }
  }

  return {
    ok: remaining === 0,
    breakdown,
    shortfall: remaining, // 0 なら在庫で払い出せる
  };
}

/** breakdown（金種→枚数）を合計金額に戻す */
export function sumBreakdown(breakdown) {
  return Object.entries(breakdown).reduce(
    (t, [d, n]) => t + Number(d) * n,
    0
  );
}

export function yen(n) {
  return `¥${Number(n).toLocaleString('ja-JP')}`;
}
