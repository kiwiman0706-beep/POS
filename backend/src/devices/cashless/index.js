import { SimulatorCashlessTerminal } from './SimulatorCashlessTerminal.js';
import { LinkedCashlessTerminal } from './LinkedCashlessTerminal.js';
import { CashlessTerminal } from './CashlessTerminal.js';
import { makeLogger } from '../../util/log.js';

/**
 * 半連動（手動確認）では端末デバイスを持たない null 実装を返す。
 * 金額連動（自動）では config.cashless.link.driver に応じて生成する。
 *   'simulator'     → ハード無しシミュレータ
 *   'linked-tcp'    → 実機（TCP連携・要: 連携仕様の差込）
 *   'linked-serial' → 実機（シリアル連携・要: 連携仕様の差込）
 */

/** 端末を持たない（半連動）ときのプレースホルダ */
class NullCashlessTerminal extends CashlessTerminal {
  async connect() {
    this.online = false;
  }
  async requestPayment() {}
  async cancelPayment() {}
}

export function createCashlessTerminal(cashlessConfig) {
  const log = makeLogger('cashless');
  const mode = cashlessConfig.mode ?? 'semi';
  if (mode !== 'auto') {
    return new NullCashlessTerminal(cashlessConfig, log);
  }
  const driver = cashlessConfig.link?.driver ?? 'simulator';
  switch (driver) {
    case 'linked-tcp':
      return new LinkedCashlessTerminal(cashlessConfig, log, 'linked-tcp');
    case 'linked-serial':
      return new LinkedCashlessTerminal(cashlessConfig, log, 'linked-serial');
    case 'simulator':
    default:
      return new SimulatorCashlessTerminal(cashlessConfig, log);
  }
}
