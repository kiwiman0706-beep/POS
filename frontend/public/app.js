import { t, I18N } from '/i18n.js';

// ---- ロール判定（/staff ならスタッフ、それ以外は患者）----
const ROLE =
  location.pathname.replace(/\/$/, '') === '/staff' ? 'staff' : 'patient';

const el = {
  clinicName: document.getElementById('clinicName'),
  roleChip: document.getElementById('roleChip'),
  conn: document.getElementById('conn'),
  screen: document.getElementById('screen'),
  staffbar: document.getElementById('staffbar'),
  toast: document.getElementById('toast'),
};
el.roleChip.textContent = ROLE === 'staff' ? 'スタッフ' : '患者';
if (ROLE === 'staff') el.staffbar.classList.remove('hidden');

let state = null;
let devices = null;
let lang = localStorage.getItem('lang') || 'ja';
let toastTimer = null;

// ---- WebSocket 接続（自動再接続）----
let ws;
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?role=${ROLE}`);
  ws.onopen = () => setConn(true);
  ws.onclose = () => {
    setConn(false);
    setTimeout(connect, 1200);
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'state') {
      state = m.state;
      if (state.config?.defaultLanguage && !localStorage.getItem('lang'))
        lang = state.config.defaultLanguage;
      render();
    } else if (m.type === 'devices') {
      devices = m;
      renderStaffbar();
    } else if (m.type === 'toast') {
      showToast(m.message);
    }
  };
}
function send(obj) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function setConn(ok) {
  el.conn.textContent = ok ? '● 接続中' : '× 切断（再接続中）';
  el.conn.className = 'conn ' + (ok ? 'ok' : 'bad');
}
function showToast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 2600);
}

const yen = (n) =>
  `<span class="yen">¥</span>${Number(n ?? 0).toLocaleString('ja-JP')}`;

// ---- メイン描画 ----
function render() {
  if (!state) return;
  el.clinicName.textContent = state.config?.clinicName ?? 'クリニック';
  const s = state;
  let html = '';

  switch (s.phase) {
    case 'IDLE':
      html = ROLE === 'staff' ? idleStaff() : idlePatient();
      break;
    case 'BILL_READY':
      html = billReady(s);
      break;
    case 'CASH_DEPOSIT':
      html = cashDeposit(s);
      break;
    case 'CASH_DISPENSE':
      html = cashDispense(s);
      break;
    case 'CASHLESS_WAIT':
      html = waitTerminal(s);
      break;
    case 'QR_WAIT':
      html = waitQr(s);
      break;
    case 'PRINTING':
      html = `<div class="headline">${t(lang, 'printing')}</div><div class="subtle">🖨️</div>`;
      break;
    case 'COMPLETE':
      html = complete(s);
      break;
    case 'ERROR':
      html = `<div class="headline">⚠️ ${s.message}</div>`;
      break;
  }
  el.screen.innerHTML = html;
  bindScreen();
  renderStaffbar();
}

function langbar() {
  const langs = state.config?.languages ?? ['ja'];
  return (
    `<div class="langbar">` +
    langs
      .map(
        (l) =>
          `<button data-lang="${l}" class="${l === lang ? 'active' : ''}">${
            (I18N[l] ?? {}).langName ?? l
          }</button>`
      )
      .join('') +
    `</div>`
  );
}

function idlePatient() {
  return `
    <div class="headline">${state.config?.clinicName ?? ''}</div>
    <div class="subtle">${t(lang, 'welcome')}</div>
    <div class="subtle" style="font-size:15px">受付でお呼びするまでお待ちください</div>
    ${langbar()}`;
}
function idleStaff() {
  return `
    <div class="headline">会計待機中</div>
    <div class="subtle">領収書バーコードをスキャン、または金額を手入力してください</div>`;
}

function billReady(s) {
  const c = state.config;
  const btn = (m, key, ic) =>
    `<button class="bigbtn method" data-method="${m}"><span class="ic">${ic}</span>${t(
      lang,
      key
    )}</button>`;
  const methods = [btn('cash', 'cash', '💴')];
  if (c.cashless?.enabled) methods.push(btn('cashless', 'cashless', '💳'));
  if (c.qr?.enabled) methods.push(btn('qr', 'qr', '📱'));
  return `
    <div class="subtle">${t(lang, 'total')}</div>
    <div class="amount">${yen(s.bill.amount)}</div>
    <div class="headline" style="font-size:24px">${t(lang, 'chooseMethod')}</div>
    <div class="grid">${methods.join('')}</div>
    ${langbar()}`;
}

function cashDeposit(s) {
  const need = s.bill.amount - s.cash.deposited;
  const rows = `
    <div class="cashrow"><span>${t(lang, 'total')}</span><span class="big">${yen(
    s.bill.amount
  )}</span></div>
    <div class="cashrow"><span>${t(lang, 'deposited')}</span><span class="big">${yen(
    s.cash.deposited
  )}</span></div>
    ${
      need > 0
        ? `<div class="cashrow short"><span>${t(lang, 'shortage')}</span><span class="big">${yen(
            need
          )}</span></div>`
        : `<div class="cashrow change"><span>${t(lang, 'change')}</span><span class="big">${yen(
            -need
          )}</span></div>`
    }`;
  let sim = '';
  if (state.config?.simulate) {
    sim = `<div class="simcash">${(state.config.denominations || [])
      .map((d) => `<button data-insert="${d}">+${d}</button>`)
      .join('')}</div>
      <div class="demo-note">※デモ用の現金投入ボタン（実機では釣銭機に直接投入）</div>`;
  }
  return `
    <div class="headline" style="font-size:26px">${t(lang, 'insertCash')}</div>
    <div class="cashbox">${rows}</div>
    ${sim}
    <div class="grid">
      <button class="bigbtn ok" id="payBtn" ${
        need > 0 ? 'disabled' : ''
      }>${t(lang, 'pay')}</button>
      <button class="bigbtn warn" id="cancelBtn">${t(lang, 'cancel')}</button>
    </div>`;
}

function cashDispense(s) {
  const bd = Object.entries(s.cash.breakdown || {})
    .sort((a, b) => b[0] - a[0])
    .map(([d, n]) => `${Number(d).toLocaleString()}円 × ${n}`)
    .join(' ／ ');
  return `
    <div class="headline">${t(lang, 'takeChange')}</div>
    <div class="amount" style="color:var(--ok)">${yen(s.cash.change)}</div>
    <div class="subtle">${bd || 'お釣りはありません'}</div>`;
}

function waitTerminal(s) {
  return `
    <div class="subtle">${t(lang, 'total')}</div>
    <div class="amount">${yen(s.bill.amount)}</div>
    <div class="headline" style="font-size:26px">💳 ${t(lang, 'useTerminal')}</div>
    <div class="subtle">${state.config.cashless.terminalModel}</div>`;
}

function waitQr(s) {
  return `
    <div class="subtle">${t(lang, 'total')}</div>
    <div class="amount">${yen(s.bill.amount)}</div>
    <div class="qrbox">
      <div class="qrph"></div>
      <div class="headline" style="font-size:22px">📱 ${t(lang, 'scanQr')}</div>
      <div class="subtle">${state.config.qr.label}</div>
    </div>`;
}

function complete(s) {
  return `
    <div class="done">
      <div class="check">✓</div>
      <div class="headline">${t(lang, 'thanks')}</div>
      <div class="subtle">${t(lang, 'total')} ${yen(s.bill?.amount)}</div>
    </div>`;
}

// ---- 画面内イベント束ね ----
function bindScreen() {
  el.screen.querySelectorAll('[data-lang]').forEach((b) =>
    b.addEventListener('click', () => {
      lang = b.dataset.lang;
      localStorage.setItem('lang', lang);
      render();
    })
  );
  el.screen.querySelectorAll('[data-method]').forEach((b) =>
    b.addEventListener('click', () =>
      send({ type: 'selectMethod', method: b.dataset.method })
    )
  );
  el.screen.querySelectorAll('[data-insert]').forEach((b) =>
    b.addEventListener('click', () =>
      send({ type: 'sim.insert', denom: Number(b.dataset.insert) })
    )
  );
  const pay = document.getElementById('payBtn');
  if (pay) pay.addEventListener('click', () => send({ type: 'settleCash' }));
  const cancel = document.getElementById('cancelBtn');
  if (cancel) cancel.addEventListener('click', () => send({ type: 'cancel' }));
}

// ---- スタッフ操作バー ----
function renderStaffbar() {
  if (ROLE !== 'staff' || !state) return;
  const s = state;
  let actions = '';

  if (['IDLE', 'BILL_READY'].includes(s.phase)) {
    actions = `
      <input type="text" id="scanInput" placeholder="バーコードをスキャン / 金額を手入力" autocomplete="off" />
      <button id="enterBtn">確定</button>`;
  }
  if (s.phase === 'CASHLESS_WAIT') {
    actions += `<button id="confirmCashless" class="">端末承認を確認</button>`;
  }
  if (s.phase === 'QR_WAIT') {
    actions += `<button id="confirmQr">着金を確認</button>`;
  }
  if (!['IDLE', 'COMPLETE'].includes(s.phase)) {
    actions += `<button id="staffCancel" class="warn">取消</button>`;
  }
  if (s.phase === 'COMPLETE') {
    actions += `<button id="nextBtn">次の会計へ</button>`;
  }

  const dev = deviceLine();
  el.staffbar.innerHTML = actions + `<div class="devinfo">${dev}</div>`;
  wireStaffbar();
}

function deviceLine() {
  if (!devices) return '';
  const cm = devices.changeMachine;
  const cmState = cm.online
    ? cm.error
      ? `⚠️釣銭機:${cm.error}`
      : '釣銭機:正常'
    : '釣銭機:未接続';
  // 在庫僅少の警告（各金種10枚未満）
  const low = Object.entries(cm.inventory || {})
    .filter(([, n]) => n < 10)
    .map(([d]) => `${d}円`);
  const lowStr = low.length ? ` / 在庫僅少:${low.join(',')}` : '';
  const pr = devices.printer?.online ? 'プリンタ:正常' : 'プリンタ:未接続';
  return `${cmState}${lowStr} ／ ${pr}`;
}

function wireStaffbar() {
  const scan = document.getElementById('scanInput');
  if (scan) {
    scan.focus();
    const submit = () => {
      const raw = scan.value.trim();
      if (!raw) return;
      // 数字のみなら手入力、それ以外はスキャン扱い（どちらもサーバでパース）
      const source = /^\d+$/.test(raw) ? 'manual' : 'scan';
      send({ type: 'setBill', raw, source });
      scan.value = '';
    };
    scan.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit(); // HIDスキャナは末尾Enterを送る
    });
    const eb = document.getElementById('enterBtn');
    if (eb) eb.addEventListener('click', submit);
  }
  const map = {
    confirmCashless: { type: 'confirmCashless' },
    confirmQr: { type: 'confirmQr' },
    staffCancel: { type: 'cancel' },
    nextBtn: { type: 'reset' },
  };
  for (const [id, msg] of Object.entries(map)) {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', () => send(msg));
  }
}

connect();
