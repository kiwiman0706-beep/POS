/**
 * レセコン領収書バーコードのパーサ。
 *
 * バーコードリーダーは USB-HID（キーボードウェッジ）として動くのが一般的で、
 * 読み取った文字列＋Enter がそのまま入力される。スタッフ画面のスキャン入力欄が
 * その文字列を受け取り、ここで「金額」等に変換する。
 *
 * レセコンの領収書バーコード仕様はベンダ（ORCA/Medicom/PsID 等）で異なるため、
 * ここに院内フォーマットに合わせたパーサを追加し、config.recept.barcode.parser で
 * 選択する。デフォルトは「数字のみ＝金額(円)」。
 *
 * 手入力も同じ parse() を通す（source を 'manual' にするだけ）。
 */

const parsers = {
  /** 既定: 数字だけ抜き出して金額(円)とみなす。例: "1234" → 1234円 */
  default(raw) {
    const digits = String(raw).replace(/[^\d]/g, '');
    if (!digits) return { ok: false, error: '金額を読み取れませんでした' };
    const amount = parseInt(digits, 10);
    return { ok: true, amount, billNo: null, patientName: null };
  },

  /**
   * 例テンプレート: "患者ID(6桁) + 伝票番号(6桁) + 金額(7桁, 0詰め)" のような
   * 固定長フォーマットを想定したサンプル。院内仕様に合わせて書き換える。
   * 例: "000123 004567 0002500" → ID=000123, 伝票=004567, 金額=2500
   */
  fixed_id_bill_amount(raw) {
    const s = String(raw).replace(/\s/g, '');
    if (s.length < 19) return { ok: false, error: 'バーコード桁数が不正です' };
    const patientNo = s.slice(0, 6);
    const billNo = s.slice(6, 12);
    const amount = parseInt(s.slice(12, 19), 10);
    if (Number.isNaN(amount))
      return { ok: false, error: '金額の解析に失敗しました' };
    return { ok: true, amount, billNo, patientName: null, patientNo };
  },
};

/**
 * @param {string} raw   スキャン/手入力の生文字列
 * @param {string} name  使用するパーサ名（config.recept.barcode.parser）
 */
export function parseBill(raw, name = 'default') {
  const fn = parsers[name] ?? parsers.default;
  const result = fn(raw);
  if (result.ok) {
    if (!Number.isFinite(result.amount) || result.amount <= 0) {
      return { ok: false, error: '金額が不正です（0円以下）' };
    }
    if (result.amount > 9_999_999) {
      return { ok: false, error: '金額が上限を超えています' };
    }
  }
  return result;
}

export const availableParsers = Object.keys(parsers);
