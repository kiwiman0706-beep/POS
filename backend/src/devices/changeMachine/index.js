import { SimulatorChangeMachine } from './SimulatorChangeMachine.js';
import { GloryRtChangeMachine } from './GloryRtChangeMachine.js';
import { makeLogger } from '../../util/log.js';

/**
 * config.changeMachine.driver に応じて釣銭機ドライバを生成する。
 *   'simulator' → ハード不要のシミュレータ
 *   'glory-rt'  → Glory RT-300/RTN-300 系 実機ドライバ
 */
export function createChangeMachine(cmConfig, denominations) {
  const log = makeLogger('changeMachine');
  switch (cmConfig.driver) {
    case 'glory-rt':
      return new GloryRtChangeMachine(cmConfig, log, denominations);
    case 'simulator':
    default:
      return new SimulatorChangeMachine(cmConfig, log, denominations);
  }
}
