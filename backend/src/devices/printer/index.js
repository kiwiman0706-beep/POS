import { SimulatorPrinter } from './SimulatorPrinter.js';
import { EscPosPrinter } from './EscPosPrinter.js';
import { makeLogger } from '../../util/log.js';

export function createPrinter(printerConfig) {
  const log = makeLogger('printer');
  switch (printerConfig.driver) {
    case 'escpos-serial':
      return new EscPosPrinter(printerConfig, log, 'serial');
    case 'escpos-network':
      return new EscPosPrinter(printerConfig, log, 'network');
    case 'simulator':
    default:
      return new SimulatorPrinter(printerConfig, log);
  }
}
