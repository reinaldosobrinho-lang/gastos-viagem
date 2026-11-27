// Interface do app. A lógica (dinheiro, datas, divisão, painel, backup) fica nos outros módulos.
import { APP_VERSION } from './version.js';
import { CURRENCIES, CATEGORIES, categoryLabel, PERSON_IDS } from './constants.js';
import { parseMoney, formatMoney, formatPlain } from './money.js';
import { todayLocal, localTimestamp, diffDays, formatDateBR, formatDateLong } from './dates.js';
import { splitEqual, buildConsumers } from './split.js';
import { dashboard } from './calc.js';
import { buildBackup, validateBackup } from './backup.js';
import { validateTrip, validatePeopleNames } from './trip.js';
import * as db from './db.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

let S = { trip: null, people: [], entries: [], expenses: [] };
let view = 'painel';
const fmt = (c) => formatMoney(c, S.trip.currency);
const hasData = () => S.entries.length > 0 || S.expenses.length > 0;

/* ---------- utilitários de UI ---------- */
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

function openSheet(title, html) {
  const sheet = $('sheet');
  sheet.innerHTML = `<div class="sheet-panel" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="sheet-head"><button class="link" type="button" data-close>Cancelar</button><h2>${esc(title)}</h2><span></span></div>
    <div class="sheet-body">${html}</div></div>`;
  sheet.hidden = false;
  document.body.classList.add('noscroll');
  sheet.scrollTop = 0;
  sheet.querySelector('[data-close]').onclick = closeSheet;
  return sheet.querySelector('.sheet-body');
}
function closeSheet() {
  $('sheet').hidden = true; $('sheet').innerHTML = '';
  document.body.classList.remove('noscroll');
}
const sheetOpen = () => !$('sheet').hidden;

function confirmDialog({ title, message, okLabel = 'Confirmar', danger = false }) {
  return new Promise((resolve) => {
    const el = $('dialog');
    el.innerHTML = `<div class="dlg" role="alertdialog" aria-modal="true"><h3>${esc(title)}</h3>
      <div class="dlg-msg">${message}</div>
      <button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(okLabel)}</button>
      <button class="btn" data-cancel>Cancelar</button></div>`;
    el.hidden = false;
    const done = (v) => { el.hidden = true; el.innerHTML = ''; resolve(v); };
    el.querySelector('[data-ok]').onclick = () => done(true);
    el.querySelector('[data-cancel]').onclick = () => done(false);
  });
}

function showErrors(el, errors) {
  if (!errors.length) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = errors.length === 1 ? esc(errors[0]) : `<ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`;
}

const optionsHtml = (list, sel, val, lab) => list.map((o) => `<option value="${esc(o[val])}" ${o[val] === sel ? 'selected' : ''}>${esc(o[lab])}</option>`).join('');

/* ---------- render principal ---------- */
function render() {
  const tabs = $('tabs');
  if (!S.trip) { tabs.hidden = true; $('title').textContent = 'Nova viagem'; renderSetup(); return; }
  tabs.hidden = false;
  const items = [['painel', '📊', 'Painel'], ['gastos', '🧾', 'Gastos'], ['saldo', '💰', 'Saldo'], ['ajustes', '⚙️', 'Ajustes']];
  tabs.innerHTML = items.map(([id, ic, lb]) => `<button data-tab="${id}" ${view === id ? 'aria-current="page"' : ''}><span aria-hidden="true">${ic}</span>${lb}</button>`).join('');
  $('title').textContent = { painel: S.trip.name, gastos: 'Gastos', saldo: 'Saldo do caixa', ajustes: 'Ajustes' }[view];
  ({ painel: renderPainel, gastos: renderGastos, saldo: renderSaldo, ajustes: renderAjustes })[view]();
}

/* ---------- Painel ---------- */
function renderPainel() {
  const D = dashboard({ trip: S.trip, people: S.people, entries: S.entries, expenses: S.expenses, today: todayLocal() });
  const t = S.trip;
  const alerts = [];
  if (D.alerts.includes('negative_balance')) {
    alerts.push(`<div class="alert danger" role="alert"><strong>Saldo negativo.</strong> Os gastos passaram do dinheiro lançado em ${fmt(-D.balance)}. Lance uma nova entrada na aba Saldo ou revise os gastos.</div>`);
  }
  if (D.alerts.includes('over_daily_limit')) {
    alerts.push(`<div class="alert warn" role="alert"><strong>Limite de hoje estourado</strong> em ${fmt(-D.remainingToday)}. Isso reduz o limite dos próximos dias.</div>`);
  }
  if (D.alerts.includes('no_entries')) {
    alerts.push('<div class="alert info">Ainda não há saldo no caixa. Lance a primeira entrada na aba <strong>Saldo</strong>.</div>');
  }
  let status;
  if (D.phase === 'before') {
    const n = diffDays(t.start, todayLocal());
    status = `<div class="alert info">A viagem começa em ${n} dia${n === 1 ? '' : 's'} (${formatDateBR(t.start)}). O limite abaixo é o <strong>previsto</strong>: saldo atual ÷ ${D.daysTotal} dias de viagem.</div>`;
  } else if (D.phase === 'after') {
    status = `<div class="alert ok"><strong>Viagem encerrada</strong> em ${formatDateBR(t.end)}. Saldo final: ${fmt(D.balance)}.</div>`;
  } else {
    status = `<div class="alert info">Dia ${D.dayIndex} de ${D.daysTotal} · restam ${D.daysRemaining} dia${D.daysRemaining === 1 ? '' : 's'} (contando hoje).</div>`;
  }
  const limitCls = D.dailyLimit !== null && D.dailyLimit < 0 ? 'neg' : '';
  const restCls = D.remainingToday !== null && D.remainingToday < 0 ? 'neg' : '';
  const maxP = Math.max(1, ...D.perPerson.map((p) => p.cents));
  $('app').innerHTML = `${alerts.join('')}${status}
    <div class="card hero"><div class="label">Saldo disponível</div><div class="value ${D.balance < 0 ? 'neg' : ''}">${fmt(D.balance)}</div>
      <div class="hint">Entradas ${fmt(D.totalIn)} − gastos ${fmt(D.totalSpent)}</div></div>
    <div class="grid">
      <div class="card stat"><div class="label">Total gasto</div><div class="value">${fmt(D.totalSpent)}</div></div>
      <div class="card stat"><div class="label">Gasto de hoje</div><div class="value">${fmt(D.spentToday)}</div></div>
      <div class="card stat"><div class="label">${D.phase === 'before' ? 'Limite diário previsto' : 'Limite diário'}</div>
        <div class="value ${limitCls}">${D.dailyLimit === null ? '—' : fmt(D.dailyLimit)}</div></div>
      <div class="card stat"><div class="label">Resta hoje</div>
        <div class="value ${restCls}">${D.remainingToday === null ? '—' : fmt(D.remainingToday)}</div></div>
    </div>
    <div class="card"><h2>Consumido por pessoa</h2>
      ${D.perPerson.map((p) => `<div class="row" style="display:block"><div style="display:flex;justify-content:space-between"><span>${esc(p.name)}</span><strong>${fmt(p.cents)}</strong></div>
        <div class="bar"><i style="width:${Math.round((p.cents / maxP) * 100)}%"></i></div></div>`).join('')}
      <p class="hint">Soma das partes de cada gasto atribuídas à pessoa.</p></div>
    <button class="btn primary" data-act="new-expense">+ Novo gasto</button>`;
}

/* ---------- Gastos ---------- */
function groupByDate(list) {
  const map = new Map();
  [...list].sort((a, b) => (a.date === b.date ? (b.createdAt || '').localeCompare(a.createdAt || '') : b.date.localeCompare(a.date)))
    .forEach((x) => { if (!map.has(x.date)) map.set(x.date, []); map.get(x.date).push(x); });
  return map;
}
function dayLabel(d) { return d === todayLocal() ? `Hoje · ${formatDateBR(d)}` : `${formatDateLong(d)} · ${formatDateBR(d)}`; }

function consumersLabel(x) {
  const names = x.consumers.map((c) => S.people.find((p) => p.id === c.personId)?.name ?? '?');
  const who = names.length === S.people.length ? 'Todos' : names.join(', ');
  return `${who}${x.splitMode === 'custom' ? ' (por valores)' : ''}`;
}

function renderGastos() {
  const groups = groupByDate(S.expenses);
  const body = [...groups.entries()].map(([d, list]) => `<div class="list-group"><h3><span>${esc(dayLabel(d))}</span><span>${fmt(list.reduce((a, x) => a + x.cents, 0))}</span></h3>
    ${list.map((x) => `<button class="item" data-act="edit-expense" data-id="${esc(x.id)}"><div><div class="t">${esc(x.store || categoryLabel(x.category))}</div>
      <div class="s">${esc(categoryLabel(x.category))}${x.description ? ' · ' + esc(x.description) : ''}</div><div class="s">${esc(consumersLabel(x))}</div></div>
      <div class="amt">${fmt(x.cents)}</div></button>`).join('')}</div>`).join('');
  $('app').innerHTML = `<button class="btn primary" data-act="new-expense" style="margin-top:0">+ Novo gasto</button>
    ${body || '<p class="muted center" style="margin-top:32px">Nenhum gasto lançado ainda.</p>'}`;
}

/* ---------- Saldo (entradas) ---------- */
function renderSaldo() {
  const D = dashboard({ trip: S.trip, people: S.people, entries: S.entries, expenses: S.expenses, today: todayLocal() });
  const groups = groupByDate(S.entries);
  const body = [...groups.entries()].map(([d, list]) => `<div class="list-group"><h3><span>${esc(dayLabel(d))}</span></h3>
    ${list.map((e) => `<button class="item" data-act="edit-entry" data-id="${esc(e.id)}"><div><div class="t">${esc(e.description || 'Entrada de saldo')}</div></div>
      <div class="amt pos">+ ${fmt(e.cents)}</div></button>`).join('')}</div>`).join('');
  $('app').innerHTML = `<div class="card hero"><div class="label">Saldo disponível</div><div class="value ${D.balance < 0 ? 'neg' : ''}">${fmt(D.balance)}</div>
      <div class="hint">Entradas ${fmt(D.totalIn)} − gastos ${fmt(D.totalSpent)}</div></div>
    <button class="btn primary" data-act="new-entry" style="margin-top:0">+ Nova entrada de saldo</button>
    ${body || '<p class="muted center" style="margin-top:32px">Nenhuma entrada lançada ainda.</p>'}`;
}

/* ---------- Formulário de entrada ---------- */
function openEntrySheet(id) {
  const en = id ? S.entries.find((e) => e.id === id) : null;
  const cur = S.trip.currency;
  const body = openSheet(en ? 'Editar entrada' : 'Nova entrada', `<form id="entForm" novalidate>
    <label>Valor (${esc(cur)})<input id="eAmount" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${en ? esc(formatPlain(en.cents, cur)) : ''}"></label>
    <label>Data<input id="eDate" type="date" value="${en ? en.date : todayLocal()}"></label>
    <label>Descrição (opcional)<input id="eDesc" maxlength="200" value="${esc(en?.description ?? '')}" placeholder="Ex.: dinheiro para a viagem"></label>
    <div id="eErr" class="error" role="alert" hidden></div>
    <button class="btn primary" type="submit">Salvar</button>
    ${en ? '<button class="btn danger" type="button" id="eDel">Excluir entrada</button>' : ''}</form>`);
  const form = body.querySelector('form');
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const errors = [];
    const cents = parseMoney($('eAmount').value, cur);
    const date = $('eDate').value;
    if (cents === null || cents <= 0) errors.push('Informe um valor maior que zero (ex.: 150,00).');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('Informe a data.');
    showErrors($('eErr'), errors);
    if (errors.length) return;
    const obj = { id: en?.id ?? uid(), date, cents, description: $('eDesc').value.trim(), createdAt: en?.createdAt ?? localTimestamp() };
    try {
      await db.putEntry(obj);
      S.entries = en ? S.entries.map((e) => (e.id === obj.id ? obj : e)) : [...S.entries, obj];
      closeSheet(); render(); toast('Entrada salva');
    } catch { showErrors($('eErr'), ['Não foi possível salvar no aparelho. Tente de novo.']); }
  };
  const del = $('eDel');
  if (del) del.onclick = async () => {
    if (!await confirmDialog({ title: 'Excluir entrada?', message: `Remove <strong>${fmt(en.cents)}</strong> do caixa. O saldo diminui nesse valor.`, okLabel: 'Excluir', danger: true })) return;
    await db.deleteEntry(en.id);
    S.entries = S.entries.filter((e) => e.id !== en.id);
    closeSheet(); render(); toast('Entrada excluída');
  };
}

/* ---------- Formulário de gasto ---------- */
function openExpenseSheet(id) {
  const ex = id ? S.expenses.find((e) => e.id === id) : null;
  const cur = S.trip.currency;
  const order = S.people.map((p) => p.id);
  const f = {
    mode: ex ? ex.splitMode : 'equal',
    selected: new Set(ex ? ex.consumers.map((c) => c.personId) : []),
    custom: ex && ex.splitMode === 'custom' ? Object.fromEntries(ex.consumers.map((c) => [c.personId, formatPlain(c.cents, cur)])) : {},
  };
  const body = openSheet(ex ? 'Editar gasto' : 'Novo gasto', `<form id="expForm" novalidate>
    <label>Valor (${esc(cur)})<input id="fAmount" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${ex ? esc(formatPlain(ex.cents, cur)) : ''}"></label>
    <label>Data<input id="fDate" type="date" value="${ex ? ex.date : todayLocal()}"></label>
    <label>Loja / local (opcional)<input id="fStore" maxlength="80" autocomplete="off" value="${esc(ex?.store ?? '')}"></label>
    <label>Categoria<select id="fCat">${optionsHtml(CATEGORIES, ex?.category ?? 'alimentacao', 'id', 'label')}</select></label>
    <label>Descrição (opcional)<input id="fDesc" maxlength="200" autocomplete="off" value="${esc(ex?.description ?? '')}"></label>
    <fieldset><legend>Quem consumiu?</legend><div id="splitBox"></div></fieldset>
    <div id="fErr" class="error" role="alert" hidden></div>
    <button class="btn primary" type="submit">Salvar gasto</button>
    ${ex ? '<button class="btn danger" type="button" id="fDel">Excluir gasto</button>' : ''}</form>`);
  const form = body.querySelector('form');
  const box = $('splitBox');

  const customParsed = () => Object.fromEntries(order.map((id2) => [id2, parseMoney(f.custom[id2] ?? '', cur)]));

  function renderSplit() {
    const chips = S.people.map((p) => `<button type="button" class="chip ${f.selected.has(p.id) ? 'on' : ''}" data-pid="${p.id}" aria-pressed="${f.selected.has(p.id)}">${esc(p.name)}</button>`).join('');
    const sel = S.people.filter((p) => f.selected.has(p.id));
    const rows = sel.map((p) => (f.mode === 'equal'
      ? `<div class="row"><span>${esc(p.name)}</span><strong data-prev="${p.id}">—</strong></div>`
      : `<div class="row"><span>${esc(p.name)}</span><input class="cust" data-cid="${p.id}" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(f.custom[p.id] ?? '')}" aria-label="Valor de ${esc(p.name)}"></div>`)).join('');
    box.innerHTML = `<div class="chips">${chips}<button type="button" class="chip" data-all>Todos</button></div>
      <div class="seg"><button type="button" data-mode="equal" class="${f.mode === 'equal' ? 'on' : ''}">Dividir igualmente</button>
      <button type="button" data-mode="custom" class="${f.mode === 'custom' ? 'on' : ''}">Por valores</button></div>
      ${sel.length ? rows : '<p class="hint">Toque nas pessoas que consumiram. Nada é escolhido automaticamente.</p>'}
      <p id="splitSum" class="hint"></p>`;
    updatePreview();
  }

  function updatePreview() {
    const total = parseMoney($('fAmount').value, cur);
    const sum = $('splitSum');
    if (!sum) return;
    if (f.mode === 'equal') {
      const ids = order.filter((i) => f.selected.has(i));
      const parts = total && total > 0 ? splitEqual(total, ids) : [];
      box.querySelectorAll('[data-prev]').forEach((el) => {
        const part = parts.find((p) => p.personId === el.dataset.prev);
        el.textContent = part ? fmt(part.cents) : '—';
      });
      sum.textContent = ids.length > 1 && total > 0 ? 'Centavos que sobram na divisão ficam com as primeiras pessoas da lista.' : '';
      sum.className = 'hint';
    } else if (f.selected.size) {
      const vals = customParsed();
      const s = order.filter((i) => f.selected.has(i)).reduce((a, i) => a + (vals[i] ?? 0), 0);
      if (total && total > 0) {
        const diff = total - s;
        sum.textContent = diff === 0 ? `Soma ${fmt(s)} = total ✔` : `Soma ${fmt(s)} de ${fmt(total)} · ${diff > 0 ? 'faltam' : 'passou'} ${fmt(Math.abs(diff))}`;
        sum.className = diff === 0 ? 'hint pos' : 'hint neg';
      } else { sum.textContent = `Soma das partes: ${fmt(s)}`; sum.className = 'hint'; }
    }
  }

  form.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.pid) { f.selected.has(b.dataset.pid) ? f.selected.delete(b.dataset.pid) : f.selected.add(b.dataset.pid); renderSplit(); }
    else if (b.hasAttribute('data-all')) { order.forEach((i) => f.selected.add(i)); renderSplit(); }
    else if (b.dataset.mode) { f.mode = b.dataset.mode; renderSplit(); }
  });
  form.addEventListener('input', (ev) => {
    if (ev.target.id === 'fAmount') updatePreview();
    else if (ev.target.dataset.cid) { f.custom[ev.target.dataset.cid] = ev.target.value; updatePreview(); }
  });

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const errors = [];
    const total = parseMoney($('fAmount').value, cur);
    const date = $('fDate').value;
    if (total === null || total <= 0) errors.push('Informe um valor maior que zero (ex.: 25,90).');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('Informe a data.');
    let consumers = null;
    if (total !== null && total > 0) {
      const r = buildConsumers({ mode: f.mode, total, order, selected: f.selected, custom: customParsed() });
      if (r.ok) consumers = r.consumers;
      else if (r.code === 'no_consumer') errors.push('Escolha quem consumiu (uma ou mais pessoas).');
      else if (r.code === 'missing_value') errors.push(`Informe o valor de ${S.people.find((p) => p.id === r.personId).name} (maior que zero).`);
      else if (r.code === 'sum_mismatch') errors.push(`As partes somam ${fmt(r.sum)}, mas o gasto é ${fmt(total)} (${r.diff > 0 ? 'faltam' : 'passou'} ${fmt(Math.abs(r.diff))}). Ajuste até fechar.`);
    } else if (f.selected.size === 0) errors.push('Escolha quem consumiu (uma ou mais pessoas).');
    showErrors($('fErr'), errors);
    if (errors.length) return;
    const obj = {
      id: ex?.id ?? uid(), date, cents: total, store: $('fStore').value.trim(), category: $('fCat').value,
      description: $('fDesc').value.trim(), splitMode: f.mode, consumers, createdAt: ex?.createdAt ?? localTimestamp(),
    };
    try {
      await db.putExpense(obj);
      S.expenses = ex ? S.expenses.map((x) => (x.id === obj.id ? obj : x)) : [...S.expenses, obj];
      closeSheet(); render(); toast('Gasto salvo');
    } catch { showErrors($('fErr'), ['Não foi possível salvar no aparelho. Tente de novo.']); }
  };
  const del = $('fDel');
  if (del) del.onclick = async () => {
    if (!await confirmDialog({ title: 'Excluir gasto?', message: `Remove <strong>${esc(ex.store || categoryLabel(ex.category))}</strong> (${fmt(ex.cents)}). O valor volta para o saldo.`, okLabel: 'Excluir', danger: true })) return;
    await db.deleteExpense(ex.id);
    S.expenses = S.expenses.filter((x) => x.id !== ex.id);
    closeSheet(); render(); toast('Gasto excluído');
  };
  renderSplit();
}

/* ---------- Viagem / pessoas (configuração e primeira execução) ---------- */
function tripFormHtml(t, people, lockCurrency) {
  return `<label>Nome da viagem<input name="name" maxlength="80" autocomplete="off" value="${esc(t?.name ?? '')}" placeholder="Ex.: Viagem em família"></label>
    <div class="two"><label>Início<input name="start" type="date" value="${esc(t?.start ?? '')}"></label>
    <label>Fim<input name="end" type="date" value="${esc(t?.end ?? '')}"></label></div>
    <label>Moeda da viagem<select name="currency" ${lockCurrency ? 'disabled' : ''}>${optionsHtml(CURRENCIES.map((c) => ({ code: c.code, label: `${c.code} — ${c.name}` })), t?.currency ?? 'USD', 'code', 'label')}</select></label>
    ${lockCurrency ? '<p class="hint">A moeda não pode mudar depois que existem lançamentos (os valores ficariam errados).</p>' : ''}
    <fieldset><legend>As 3 pessoas</legend>${[0, 1, 2].map((i) => `<label>Pessoa ${i + 1}<input name="p${i}" maxlength="30" autocomplete="off" value="${esc(people[i]?.name ?? '')}"></label>`).join('')}</fieldset>`;
}

function readTripForm(form, lockedCurrency) {
  const v = (n) => form.elements[n].value;
  const trip = { name: v('name').trim(), start: v('start'), end: v('end'), currency: lockedCurrency ?? v('currency') };
  const names = [0, 1, 2].map((i) => v(`p${i}`).trim());
  const errors = [...validateTrip(trip), ...validatePeopleNames(names)];
  return { errors, trip, people: PERSON_IDS.map((id, i) => ({ id, name: names[i] })) };
}

function renderSetup() {
  $('app').innerHTML = `<p class="muted">Configure a viagem para começar. A moeda é única para toda a viagem.</p>
    <form id="setupForm" novalidate>${tripFormHtml(null, [], false)}
    <div id="setupErr" class="error" role="alert" hidden></div>
    <button class="btn primary" type="submit">Criar viagem</button></form>
    <button class="btn" data-act="restore">Restaurar de um backup (.json)</button>`;
  const form = $('setupForm');
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const r = readTripForm(form, null);
    showErrors($('setupErr'), r.errors);
    if (r.errors.length) return;
    try { await db.saveTrip(r.trip, r.people); S.trip = r.trip; S.people = r.people; view = 'painel'; render(); }
    catch { showErrors($('setupErr'), ['Não foi possível salvar no aparelho.']); }
  };
}

/* ---------- Ajustes ---------- */
let persistStatus = 'verificando…';
function renderAjustes() {
  const lock = hasData();
  $('app').innerHTML = `<div class="card"><h2>Viagem</h2><form id="tripForm" novalidate>${tripFormHtml(S.trip, S.people, lock)}
      <div id="tripErr" class="error" role="alert" hidden></div>
      <button class="btn primary" type="submit">Salvar alterações</button></form></div>
    <div class="card"><h2>Backup</h2>
      <p class="hint">Seus dados ficam só neste aparelho. Exporte um backup de vez em quando e guarde em Arquivos/iCloud.</p>
      <button class="btn" data-act="export">Exportar backup (.json)</button>
      <button class="btn" data-act="restore">Restaurar backup…</button></div>
    <div class="card"><h2>Sobre</h2>
      <p class="hint">Versão ${esc(APP_VERSION)} · armazenamento persistente: ${esc(persistStatus)}</p>
      <p class="hint"><strong>Use sempre o app instalado na Tela de Início.</strong> Os dados do Safari e do app instalado são separados.</p></div>`;
  $('tripForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const r = readTripForm(ev.target, lock ? S.trip.currency : null);
    showErrors($('tripErr'), r.errors);
    if (r.errors.length) return;
    try { await db.saveTrip(r.trip, r.people); S.trip = r.trip; S.people = r.people; toast('Alterações salvas'); render(); }
    catch { showErrors($('tripErr'), ['Não foi possível salvar no aparelho.']); }
  };
}

/* ---------- Backup ---------- */
async function exportBackup() {
  const text = JSON.stringify(buildBackup(S), null, 2);
  const name = `gastos-viagem-${todayLocal()}.json`;
  try {
    const file = new File([text], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      toast('Backup pronto — salve em Arquivos'); return;
    }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('Backup exportado');
}

async function handleRestoreFile(file) {
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { await confirmDialog({ title: 'Arquivo grande demais', message: 'O backup deve ter menos de 5 MB.', okLabel: 'Ok' }); return; }
  const result = validateBackup(await file.text());
  if (!result.ok) {
    await confirmDialog({ title: 'Backup inválido', message: `Nada foi alterado.<ul>${result.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`, okLabel: 'Entendi' });
    return;
  }
  const s = result.summary;
  const atual = S.trip ? `<p>Dados atuais que serão <strong>apagados</strong>: ${esc(S.trip.name)} — ${S.entries.length} entrada(s), ${S.expenses.length} gasto(s).</p>` : '';
  const ok = await confirmDialog({
    title: 'Restaurar este backup?',
    message: `${atual}<p>Backup: <strong>${esc(s.tripName)}</strong> (${formatDateBR(s.start)} a ${formatDateBR(s.end)}, ${esc(s.currency)}) — ${s.entries} entrada(s), ${s.expenses} gasto(s)${s.exportedAt ? `, exportado em ${esc(s.exportedAt.replace('T', ' '))}` : ''}.</p><p>Isso <strong>sobrescreve tudo</strong> o que está no app agora.</p>`,
    okLabel: 'Sobrescrever e restaurar', danger: true,
  });
  if (!ok) return;
  try {
    await db.replaceAll(result.data);
    S = await db.loadAll(); view = 'painel'; closeSheet(); render(); toast('Backup restaurado');
  } catch { await confirmDialog({ title: 'Falha ao restaurar', message: 'Nada foi alterado. Tente novamente.', okLabel: 'Ok' }); }
}

/* ---------- Eventos globais ---------- */
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-tab],[data-act]');
  if (!el) return;
  if (el.dataset.tab) { view = el.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const act = el.dataset.act;
  if (act === 'new-expense') openExpenseSheet(null);
  else if (act === 'edit-expense') openExpenseSheet(el.dataset.id);
  else if (act === 'new-entry') openEntrySheet(null);
  else if (act === 'edit-entry') openEntrySheet(el.dataset.id);
  else if (act === 'export') exportBackup();
  else if (act === 'restore') { $('filePicker').value = ''; $('filePicker').click(); }
});
$('filePicker').addEventListener('change', (ev) => handleRestoreFile(ev.target.files[0]));
document.addEventListener('visibilitychange', () => {
  // Ao voltar para o app (ex.: virou o dia), atualiza só o Painel e só se não houver formulário aberto.
  if (!document.hidden && S.trip && view === 'painel' && !sheetOpen()) render();
});

/* ---------- Service worker e atualização ---------- */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  let reloading = false;
  let userAsked = false;
  const banner = $('banner');
  const offer = (worker) => {
    banner.innerHTML = '<span>Nova versão disponível</span><button type="button">Atualizar</button>';
    banner.hidden = false;
    banner.querySelector('button').onclick = () => { userAsked = true; worker.postMessage('SKIP_WAITING'); };
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (userAsked && !reloading) { reloading = true; location.reload(); }
  });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
}

/* ---------- Início ---------- */
async function boot() {
  try {
    await db.openDB();
    S = await db.loadAll();
  } catch {
    $('app').innerHTML = '<div class="alert danger">Não foi possível abrir o armazenamento do aparelho. Feche e abra o app de novo. Se persistir, verifique o espaço disponível no iPhone.</div>';
    return;
  }
  if (navigator.storage?.persist) {
    navigator.storage.persist().then((ok) => { persistStatus = ok ? 'sim' : 'não garantido'; }).catch(() => { persistStatus = 'indisponível'; });
  } else persistStatus = 'indisponível';
  registerSW();
  render();
}
boot();
