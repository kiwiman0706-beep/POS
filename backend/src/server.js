import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { makeLogger } from './util/log.js';
import { createChangeMachine } from './devices/changeMachine/index.js';
import { createPrinter } from './devices/printer/index.js';
import { createCashlessTerminal } from './devices/cashless/index.js';
import { CheckoutSession } from './checkout/CheckoutSession.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PUBLIC_DIR = path.join(ROOT, 'frontend', 'public');
const log = makeLogger('server');

// ---- config 読み込み ----
const config = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')
);

// ---- デバイス生成 ----
const changeMachine = createChangeMachine(
  config.changeMachine,
  config.currency.denominations
);
const printer = createPrinter(config.printer);
const cashless = createCashlessTerminal(config.cashless);

const session = new CheckoutSession({ config, changeMachine, printer, cashless });

// ---- 静的配信 ----
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';

  // 患者/スタッフ用のショートカット
  if (pathname === '/patient') pathname = '/index.html';
  if (pathname === '/staff') pathname = '/index.html';

  const filePath = path.join(PUBLIC_DIR, pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
    });
    res.end(data);
  });
});

// ---- WebSocket ハブ（2画面ミラー同期の要）----
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set();

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

function deviceSnapshot() {
  return {
    type: 'devices',
    changeMachine: changeMachine.snapshot(),
    printer: printer.snapshot(),
    cashless: cashless.snapshot(),
  };
}

// セッション状態が変わったら全画面へ配信 → これが「ミラーリング」の実体
session.on('state', (s) => broadcast({ type: 'state', state: s }));
session.on('toast', (t) => broadcast({ type: 'toast', ...t }));
changeMachine.on('status', () => broadcast(deviceSnapshot()));
cashless.on('status', () => broadcast(deviceSnapshot()));

wss.on('connection', (ws, req) => {
  clients.add(ws);
  const url = new URL(req.url, `http://${req.headers.host}`);
  ws.role = url.searchParams.get('role') === 'staff' ? 'staff' : 'patient';
  log.info(`接続: role=${ws.role}（接続数 ${clients.size}）`);

  // 初期同期
  ws.send(JSON.stringify({ type: 'state', state: session.snapshot() }));
  ws.send(JSON.stringify(deviceSnapshot()));

  ws.on('message', (buf) => {
    let m;
    try {
      m = JSON.parse(buf.toString());
    } catch {
      return;
    }
    handleMessage(ws, m);
  });

  ws.on('close', () => {
    clients.delete(ws);
    log.info(`切断: role=${ws.role}（接続数 ${clients.size}）`);
  });
});

function handleMessage(ws, m) {
  switch (m.type) {
    // --- スタッフ操作 ---
    case 'setBill': // {raw, source:'scan'|'manual'}
      session.setBill(m.raw, m.source ?? 'scan');
      break;
    case 'confirmCashless':
      session.confirmCashless();
      break;
    case 'retryCashless':
      session.retryCashless();
      break;
    case 'confirmQr':
      session.confirmQr();
      break;
    case 'cancel':
      session.cancel();
      break;
    case 'reset':
      session.reset();
      break;

    // --- 患者/スタッフ共通 ---
    case 'selectMethod': // {method}
      session.selectMethod(m.method);
      break;
    case 'settleCash':
      session.settleCash();
      break;

    // --- デモ専用（シミュレータのみ）: 現金投入エミュレート ---
    case 'sim.insert': // {denom}
      if (config.changeMachine.driver === 'simulator' && changeMachine.insert) {
        changeMachine.insert(m.denom);
      }
      break;

    // --- デモ専用（シミュレータのみ）: キャッシュレス承認/否認エミュレート ---
    case 'sim.cashless.approve':
      if (cashless.approve) cashless.approve();
      break;
    case 'sim.cashless.decline':
      if (cashless.decline) cashless.decline();
      break;

    default:
      log.warn('未知のメッセージ', m.type);
  }
}

// ---- 起動 ----
(async () => {
  await changeMachine.connect().catch((e) => {
    log.error('釣銭機接続エラー:', e.message);
  });
  await printer.connect().catch((e) => {
    log.error('プリンタ接続エラー:', e.message);
  });
  await cashless.connect().catch((e) => {
    log.error('決済端末接続エラー:', e.message);
  });

  server.listen(config.port, config.host, () => {
    log.info('==================================================');
    log.info(`  ${config.clinicName} セミセルフレジ 起動`);
    log.info(`  患者側 : http://localhost:${config.port}/patient`);
    log.info(`  スタッフ側: http://localhost:${config.port}/staff`);
    log.info(`  釣銭機 : ${config.changeMachine.driver} / プリンタ: ${config.printer.driver}`);
    log.info('==================================================');
  });
})();

process.on('SIGINT', async () => {
  log.info('終了します…');
  await changeMachine.disconnect().catch(() => {});
  await printer.disconnect().catch(() => {});
  await cashless.disconnect().catch(() => {});
  process.exit(0);
});
