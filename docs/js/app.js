// Interface do app. A lógica (dinheiro, datas, divisão, painel, backup) fica nos outros módulos.
import { APP_VERSION } from './version.js';
import { CURRENCIES, CATEGORIES, ACTIVITY_STATUS, categoryLabel, PERSON_IDS } from './constants.js';
import { parseMoney, formatMoney, formatPlain, minorDigits } from './money.js';
import { todayLocal, localTimestamp, diffDays, formatDateBR, formatDateLong } from './dates.js';
import { splitEqual, buildConsumers, buildShares } from './split.js';
import { computeForecast } from './forecast.js';
import { timelineData } from './timeline.js';
import { buildTimelineSvg, COL } from './chart.js';
import { ICON_CHOICES, DEFAULT_ICON, suggestIcon } from './icons.js';
import { parseScheduleImport } from './schedule-import.js';
import { applyBulkPrices } from './bulk-price.js';
import { dashboard } from './calc.js';
import { buildBackup, validateBackup } from './backup.js';
import { validateTrip, validatePeopleNames } from './trip.js';
import * as db from './db.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

let S = { trip: null, people: [], entries: [], expenses: [], activities: [] };
let view = 'painel';
const fmt = (c) => formatMoney(c, S.trip.currency);
const hasData = () => S.entries.length > 0 || S.expenses.length > 0 || S.activities.length > 0;
const STATUS_LABEL = Object.fromEntries(ACTIVITY_STATUS.map((x) => [x.id, x.label]));
const activityTitle = (id) => S.activities.find((a) => a.id === id)?.title ?? '';

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
  const items = [['painel', '📊', 'Painel'], ['gastos', '🧾', 'Gastos'], ['crono', '🗓️', 'Cronograma'], ['saldo', '💰', 'Saldo'], ['ajustes', '⚙️', 'Ajustes']];
  tabs.innerHTML = items.map(([id, ic, lb]) => `<button data-tab="${id}" ${view === id ? 'aria-current="page"' : ''}><span aria-hidden="true">${ic}</span>${lb}</button>`).join('');
  $('title').textContent = { painel: S.trip.name, gastos: 'Gastos', crono: 'Cronograma', saldo: 'Saldo do caixa', ajustes: 'Ajustes' }[view];
  ({ painel: renderPainel, gastos: renderGastos, crono: renderCronograma, saldo: renderSaldo, ajustes: renderAjustes })[view]();
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
  let forecastCard = '';
  if (S.activities.length) {
    const F = getForecast();
    alerts.push(...forecastAlerts(F));
    forecastCard = `<div class="card"><h2>Previsão da viagem</h2>
      <div class="kv"><span>Previsão restante</span><b>${range(F.trip.remMin, F.trip.remMax)}</b></div>
      <div class="kv"><span>Saldo projetado (mínimo)</span><b class="${F.trip.projMin < 0 ? 'neg' : ''}">${fmt(F.trip.projMin)}</b></div>
      <div class="kv"><span>Saldo projetado (máximo)</span><b class="${F.trip.projMax < 0 ? 'neg' : ''}">${fmt(F.trip.projMax)}</b></div>
      <button class="btn" data-act="goto" data-view="crono">Ver cronograma</button></div>`;
  }
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
    ${forecastCard}
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
      <div class="s">${esc(categoryLabel(x.category))}${x.description ? ' · ' + esc(x.description) : ''}</div><div class="s">${esc(consumersLabel(x))}</div>${x.activityId && activityTitle(x.activityId) ? `<div class="s">${esc(S.activities.find((a) => a.id === x.activityId)?.icon || '🗓️')} ${esc(activityTitle(x.activityId))}</div>` : ''}</div>
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

/* ---------- Cronograma e previsão ---------- */
const range = (a, b) => (a === b ? fmt(a) : `${fmt(a)} a ${fmt(b)}`);
const isPriced = (a) => a.min !== null && a.min !== undefined;
const iconOf = (a) => a.icon || DEFAULT_ICON;

function getForecast() {
  const D = dashboard({ trip: S.trip, people: S.people, entries: S.entries, expenses: S.expenses, today: todayLocal() });
  return computeForecast({ trip: S.trip, people: S.people, activities: S.activities, expenses: S.expenses, today: todayLocal(), balance: D.balance });
}

function forecastAlerts(F) {
  const out = [];
  if (F.alerts.includes('min_not_covered')) {
    out.push(`<div class="alert danger" role="alert"><strong>O saldo não cobre nem o cenário mínimo.</strong> Saldo ${fmt(F.trip.balance)} para uma previsão restante de, no mínimo, ${fmt(F.trip.remMin)}: faltam ${fmt(-F.trip.projMin)}.</div>`);
  } else if (F.alerts.includes('max_not_covered')) {
    out.push(`<div class="alert warn" role="alert"><strong>O saldo cobre o mínimo, mas não o máximo.</strong> Se as atividades custarem o máximo, faltam ${fmt(-F.trip.projMax)}.</div>`);
  }
  if (F.unpriced.length) {
    out.push(`<div class="alert info"><strong>${F.unpriced.length} atividade${F.unpriced.length === 1 ? '' : 's'} planejada${F.unpriced.length === 1 ? '' : 's'} sem valor previsto.</strong> A previsão e o saldo projetado ainda não incluem esses gastos. Preencha o mínimo e o máximo quando souber. <button class="link" data-act="bulk-price">Definir valores</button></div>`);
  }
  return out;
}

function dayPlanned(ids) {
  const live = ids.map((id) => S.activities.find((a) => a.id === id)).filter((a) => a && a.status !== 'cancelled' && isPriced(a));
  if (!live.length) return '';
  return range(live.reduce((n, a) => n + a.min, 0), live.reduce((n, a) => n + a.max, 0));
}

const projCls = (v) => (v !== null && v < 0 ? 'neg' : '');

/* --- linha do tempo --- */
let tlSelDate = null;
let tlAnimate = false;
let tlTimer = null;

function tlDayHtml(T, i) {
  const d = T.days[i];
  const acts = d.activityIds.map((id) => S.activities.find((a) => a.id === id)).filter(Boolean);
  const label = d.date === todayLocal() ? `Hoje · ${formatDateBR(d.date)}` : `${formatDateLong(d.date)} · ${formatDateBR(d.date)}`;
  const over = d.planMax > 0 && d.realSpent > d.planMax;
  const rows = acts.map((a) => `<div class="tl-act ${a.status === 'cancelled' ? 'off' : ''}">
      <span class="ico" aria-hidden="true">${esc(iconOf(a))}</span>
      <button class="link" data-act="edit-activity" data-id="${esc(a.id)}">${esc(a.title)}</button>
      <span class="badge ${a.status}">${esc(STATUS_LABEL[a.status])}</span>
      <span class="tl-act-btns">${a.status === 'planned'
        ? `<button class="mini" data-act="set-status" data-id="${esc(a.id)}" data-status="done" aria-label="Marcar ${esc(a.title)} como concluída">✔</button><button class="mini" data-act="set-status" data-id="${esc(a.id)}" data-status="cancelled" aria-label="Cancelar ${esc(a.title)}">✖</button>`
        : `<button class="mini" data-act="set-status" data-id="${esc(a.id)}" data-status="planned" aria-label="Voltar ${esc(a.title)} para planejada">↺</button>`}</span>
      <div class="s">${isPriced(a) ? `Previsto ${range(a.min, a.max)}` : 'Valor a definir'}</div></div>`).join('');
  return `<h3>${esc(label)}</h3>
    ${d.balReal !== null ? `<div class="kv"><span>Saldo real (fim do dia)</span><b class="${projCls(d.balReal)}">${fmt(d.balReal)}</b></div>` : ''}
    ${d.projMin !== null ? `<div class="kv"><span>Saldo projetado (mín. / máx.)</span><b><span class="${projCls(d.projMin)}">${fmt(d.projMin)}</span> / <span class="${projCls(d.projMax)}">${fmt(d.projMax)}</span></b></div>` : ''}
    <div class="kv"><span>Planejado no dia</span><b>${d.planMax > 0 || d.planMin > 0 ? range(d.planMin, d.planMax) : '—'}</b></div>
    <div class="kv"><span>Gasto real no dia</span><b class="${over ? 'neg' : ''}">${fmt(d.realSpent)}</b></div>
    ${over ? '<p class="hint neg">Gasto acima do máximo planejado para o dia.</p>' : ''}
    ${d.unpriced ? `<p class="hint">${d.unpriced} atividade${d.unpriced === 1 ? '' : 's'} sem valor previsto.</p>` : ''}
    ${rows || '<p class="hint">Nenhuma atividade neste dia.</p>'}
    <div class="two"><button class="btn" data-act="add-activity" data-date="${d.date}">+ Atividade</button><button class="btn" data-act="new-expense" data-date="${d.date}">+ Gasto</button></div>`;
}

function initTimeline(F) {
  clearInterval(tlTimer);
  const card = $('tlCard');
  if (!card) return;
  const T = timelineData({ entries: S.entries, expenses: S.expenses, activities: S.activities, forecast: F, today: todayLocal() });
  if (!T.days.length) return;
  const digits = minorDigits(S.trip.currency);
  const nf = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
  const label = (v) => nf.format(v / 10 ** digits);
  const ch = buildTimelineSvg(T, { label });
  const anim = () => (tlAnimate ? 'tl-anim' : '');
  card.innerHTML = `<div class="tl-head"><h2>Linha do tempo</h2><button class="link" data-act="tl-play">▶ Reproduzir</button></div>
    <div class="tl-legend"><span class="lg"><i class="sw real-line"></i>Saldo real</span>
      <span class="lg"><i class="sw best"></i>Se gastar o mínimo</span><span class="lg"><i class="sw worst"></i>Se gastar o máximo</span>
      <span class="lg"><i class="sw plan"></i>Planejado (mín. a máx.)</span><span class="lg"><i class="sw real-bar"></i>Gasto real</span></div>
    <div class="tl-wrap"><div class="tl-axis">${ch.axis}</div><div class="tl-scroll ${anim()}" id="tlScroll">${ch.plot}</div></div>
    <p class="hint">Toque em um dia para ver os detalhes e fazer ajustes. Ponto marrom = atividade sem valor previsto.</p>
    <div id="tlDay" class="tl-day"></div>`;
  const scroll = $('tlScroll');

  const select = (i, scrollTo = false) => {
    tlSelDate = T.days[i].date;
    const sel = $('tlSel');
    if (sel) { sel.setAttribute('x', i * COL); sel.setAttribute('visibility', 'visible'); }
    $('tlDay').innerHTML = tlDayHtml(T, i);
    if (scrollTo) scroll.scrollTo({ left: Math.max(0, ch.xOf(i) - scroll.clientWidth / 2), behavior: 'smooth' });
  };
  let idx = T.days.findIndex((d) => d.date === tlSelDate);
  if (idx < 0) idx = T.todayIndex >= 0 ? T.todayIndex : 0;
  select(idx);
  scroll.scrollLeft = Math.max(0, ch.xOf(idx) - scroll.clientWidth / 2);
  tlAnimate = false;

  card.onclick = (ev) => {
    const hit = ev.target.closest('.tl-hit');
    if (hit) { clearInterval(tlTimer); select(Number(hit.dataset.i)); return; }
    if (ev.target.closest('[data-act="tl-play"]')) {
      clearInterval(tlTimer);
      $('tlScroll').outerHTML = `<div class="tl-scroll tl-anim" id="tlScroll">${ch.plot}</div>`; // reinsere o SVG: reinicia as animações
      const sc = $('tlScroll');
      sc.scrollLeft = 0;
      let i = 0;
      tlTimer = setInterval(() => {
        const sel = $('tlSel');
        if (!sel || i >= T.days.length) { clearInterval(tlTimer); return; }
        sel.setAttribute('x', i * COL); sel.setAttribute('visibility', 'visible');
        $('tlDay').innerHTML = tlDayHtml(T, i);
        tlSelDate = T.days[i].date;
        sc.scrollTo({ left: Math.max(0, ch.xOf(i) - sc.clientWidth / 2), behavior: 'smooth' });
        i += 1;
      }, 320);
    }
  };
}

function renderCronograma() {
  const F = getForecast();
  const today = todayLocal();
  const t = F.trip;
  const parts = [];
  parts.push(...forecastAlerts(F));
  if (F.overdue.length) {
    parts.push(`<div class="alert warn"><strong>${F.overdue.length} atividade${F.overdue.length === 1 ? '' : 's'} de dia passado ainda pendente${F.overdue.length === 1 ? '' : 's'}.</strong> Marque como concluída ou cancelada para tirar da previsão:
      ${F.overdue.map((id) => { const a = S.activities.find((x) => x.id === id); return `<button class="link" data-act="edit-activity" data-id="${esc(id)}">${esc(a.title)} (${formatDateBR(a.date)})</button>`; }).join(' · ')}</div>`);
  }
  if (F.overspent.length) {
    parts.push(`<div class="alert info">Já foi gasto mais que o máximo previsto em: ${F.overspent.map((id) => esc(activityTitle(id))).join(', ')}. Considere revisar a previsão.</div>`);
  }
  if (F.noForecastDays.length) {
    const shown = F.noForecastDays.slice(0, 5).map(formatDateBR).join(', ');
    parts.push(`<div class="alert info"><strong>${F.noForecastDays.length} dia${F.noForecastDays.length === 1 ? '' : 's'} sem previsão</strong> (${shown}${F.noForecastDays.length > 5 ? '…' : ''}). Lembre de incluir refeições e transporte.</div>`);
  }
  parts.push('<div class="card tl" id="tlCard"></div>');
  parts.push(`<div class="card"><h2>Viagem toda</h2>
    <div class="kv"><span>Saldo atual</span><b class="${projCls(t.balance)}">${fmt(t.balance)}</b></div>
    <div class="kv"><span>Gasto real</span><b>${fmt(t.real)}</b></div>
    <div class="kv"><span>Previsão restante (mín. a máx.)</span><b>${range(t.remMin, t.remMax)}</b></div>
    <div class="kv"><span>Total estimado (real + restante)</span><b>${range(t.estMin, t.estMax)}</b></div>
    <div class="kv"><span>Saldo projetado · cenário mínimo</span><b class="${projCls(t.projMin)}">${fmt(t.projMin)}</b></div>
    <div class="kv"><span>Saldo projetado · cenário máximo</span><b class="${projCls(t.projMax)}">${fmt(t.projMax)}</b></div>
    <p class="hint">A previsão restante já desconta o que foi gasto e vinculado à atividade (nada é contado duas vezes) e só considera atividades com valor previsto. Lembre de incluir refeições e transporte.</p></div>`);

  parts.push(`<div class="card"><h2>Por pessoa</h2>${F.persons.map((p) => `<div class="person">
      <div class="kv"><strong>${esc(p.name)}</strong><span></span></div>
      <div class="kv"><span>Já consumido</span><b>${fmt(p.consumed)}</b></div>
      <div class="kv"><span>Ainda previsto</span><b>${range(p.remMin, p.remMax)}</b></div>
      <div class="kv"><span>Total estimado</span><b>${range(p.estMin, p.estMax)}</b></div></div>`).join('')}
    <p class="hint">Por pessoa, o cálculo usa a parte de cada participante e o que ela mesma consumiu nos gastos vinculados. Por isso a soma das pessoas pode diferir do total da atividade quando o gasto real foi dividido diferente da previsão.</p></div>`);

  parts.push('<button class="btn primary" data-act="new-activity" style="margin-top:0">+ Nova atividade</button><button class="btn" data-act="bulk-price">Definir valores das atividades</button><button class="btn" data-act="import-schedule">Importar cronograma (.json)</button><button class="btn" data-act="paste-schedule">Colar cronograma (texto)</button>');

  const visible = F.days.filter((d) => d.future || d.activities.length || d.realSpent > 0);
  parts.push(visible.map((d) => {
    const label = d.date === today ? `Hoje · ${formatDateBR(d.date)}` : `${formatDateLong(d.date)} · ${formatDateBR(d.date)}`;
    const items = d.activities.map((id) => {
      const a = S.activities.find((x) => x.id === id);
      const r = F.perActivity[id];
      const who = a.participants.length === S.people.length ? 'Todos' : a.participants.map((pid) => S.people.find((p) => p.id === pid)?.name ?? '?').join(', ');
      return `<button class="item" data-act="edit-activity" data-id="${esc(id)}"><span class="ico big" aria-hidden="true">${esc(iconOf(a))}</span><div style="flex:1">
        <div class="t">${esc(a.title)}</div>
        <div class="s"><span class="badge ${a.status}">${esc(STATUS_LABEL[a.status])}</span> ${esc(who)}</div>
        <div class="s">${isPriced(a) ? `Previsto ${range(a.min, a.max)}${r.spent ? ` · gasto ${fmt(r.spent)}` : ''}${a.status === 'planned' ? ` · resta ${range(r.remMin, r.remMax)}` : ''}` : `Valor a definir${r.spent ? ` · gasto ${fmt(r.spent)}` : ''}`}</div></div></button>`;
    }).join('');
    return `<div class="card day ${d.future ? '' : 'past'}"><h3>${esc(label)}</h3>
      ${d.outOfRange ? '<p class="hint neg">Fora do período da viagem.</p>' : ''}
      <div class="kv"><span>Gasto real</span><b>${fmt(d.realSpent)}</b></div>
      ${dayPlanned(d.activities) ? `<div class="kv"><span>Planejado no dia</span><b>${dayPlanned(d.activities)}</b></div>` : ''}
      ${d.future ? `<div class="kv"><span>Previsão restante</span><b>${range(d.remMin, d.remMax)}</b></div>
        <div class="kv"><span>Saldo projetado (mín. / máx.)</span><b><span class="${projCls(d.projMin)}">${fmt(d.projMin)}</span> / <span class="${projCls(d.projMax)}">${fmt(d.projMax)}</span></b></div>` : ''}
      ${d.noForecast ? '<p class="hint">Sem previsão neste dia. Lembre de incluir refeições e transporte.</p>' : ''}
      ${items}
      <button class="link" data-act="add-activity" data-date="${d.date}">+ Atividade neste dia</button></div>`;
  }).join(''));
  $('app').innerHTML = parts.join('');
  initTimeline(F);
}

function openBulkPriceSheet() {
  const cur = S.trip.currency;
  const order = S.people.map((p) => p.id);
  const todo = S.activities.filter((a) => a.status === 'planned' && !isPriced(a))
    .sort((p, q) => p.date.localeCompare(q.date) || (p.createdAt || '').localeCompare(q.createdAt || ''));
  if (!todo.length) { toast('Todas as atividades planejadas já têm valor.'); return; }
  const f = { per: 'total' };
  const groups = new Map();
  todo.forEach((a) => { if (!groups.has(a.date)) groups.set(a.date, []); groups.get(a.date).push(a); });
  const rows = [...groups.entries()].map(([d, list]) => `<h3 class="bulk-day">${esc(formatDateLong(d))} · ${formatDateBR(d)}</h3>${list.map((a) => `<div class="brow" data-id="${esc(a.id)}">
      <div class="t"><span class="ico" aria-hidden="true">${esc(iconOf(a))}</span> ${esc(a.title)} <span class="hint">· ${a.participants.length} pessoa${a.participants.length === 1 ? '' : 's'}</span></div>
      <div class="two"><input data-k="min" inputmode="decimal" autocomplete="off" placeholder="mínimo" aria-label="Mínimo de ${esc(a.title)}">
      <input data-k="max" inputmode="decimal" autocomplete="off" placeholder="máximo" aria-label="Máximo de ${esc(a.title)}"></div></div>`).join('')}`).join('');
  const body = openSheet('Definir valores', `<form id="bulkForm" novalidate>
    <p class="hint">Informe o que você estima gastar em cada atividade (${esc(cur)}). Deixe em branco o que ainda não sabe. O app não inventa preços.</p>
    <div class="seg"><button type="button" data-per="total" class="on">Valor total da atividade</button><button type="button" data-per="person">Valor por pessoa</button></div>
    <p class="hint">Ao preencher uma atividade, as outras com o <strong>mesmo nome</strong> que estiverem vazias recebem os mesmos valores (você pode alterar).</p>
    ${rows}
    <p id="bulkSum" class="hint" style="margin-top:14px"></p>
    <div id="bErr" class="error" role="alert" hidden></div>
    <button class="btn primary" type="submit">Salvar valores preenchidos</button></form>`);
  const form = body.querySelector('form');
  const values = () => Object.fromEntries([...form.querySelectorAll('.brow')].map((r) => [r.dataset.id, {
    min: r.querySelector('[data-k=min]').value, max: r.querySelector('[data-k=max]').value }]));
  const compute = () => applyBulkPrices({ activities: todo, values: values(), per: f.per, order, parse: (t) => parseMoney(t, cur) });
  const updateSum = () => {
    const r = compute();
    $('bulkSum').textContent = r.ok && r.updated.length ? `${r.updated.length} atividade(s) preenchida(s): planejado total de ${range(r.total.min, r.total.max)}.` : '';
  };
  form.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-per]');
    if (!b) return;
    f.per = b.dataset.per;
    form.querySelectorAll('[data-per]').forEach((x) => x.classList.toggle('on', x === b));
    updateSum();
  });
  form.addEventListener('input', updateSum);
  form.addEventListener('change', (ev) => { // copia para atividades de mesmo nome que ainda estão vazias
    const row = ev.target.closest('.brow');
    if (!row) return;
    const title = (todo.find((a) => a.id === row.dataset.id)?.title ?? '').trim().toLowerCase();
    const mn = row.querySelector('[data-k=min]').value.trim();
    const mx = row.querySelector('[data-k=max]').value.trim();
    if (!mn || !mx) return;
    form.querySelectorAll('.brow').forEach((r) => {
      if (r === row) return;
      const t = (todo.find((a) => a.id === r.dataset.id)?.title ?? '').trim().toLowerCase();
      const i1 = r.querySelector('[data-k=min]'); const i2 = r.querySelector('[data-k=max]');
      if (t === title && !i1.value.trim() && !i2.value.trim()) { i1.value = mn; i2.value = mx; }
    });
    updateSum();
  });
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const r = compute();
    if (!r.ok) { showErrors($('bErr'), r.errors); return; }
    if (!r.updated.length) { showErrors($('bErr'), ['Preencha o mínimo e o máximo de pelo menos uma atividade.']); return; }
    try {
      await db.putActivities(r.updated);
      const byId = new Map(r.updated.map((a) => [a.id, a]));
      S.activities = S.activities.map((a) => byId.get(a.id) ?? a);
      closeSheet(); render(); toast(`${r.updated.length} atividade(s) com valor`);
    } catch { showErrors($('bErr'), ['Não foi possível salvar no aparelho. Tente de novo.']); }
  };
}

async function setActivityStatus(id, status) {
  const a = S.activities.find((x) => x.id === id);
  if (!a || a.status === status) return;
  const obj = { ...a, status };
  try {
    await db.putActivity(obj);
    S.activities = S.activities.map((x) => (x.id === id ? obj : x));
    render(); toast(`Atividade ${STATUS_LABEL[status].toLowerCase()}`);
  } catch { toast('Não foi possível salvar no aparelho.'); }
}

async function handleScheduleFile(file) {
  if (!file) return;
  if (file.size > 1024 * 1024) { await confirmDialog({ title: 'Arquivo grande demais', message: 'O cronograma deve ter menos de 1 MB.', okLabel: 'Ok' }); return; }
  await importScheduleText(await file.text());
}

function openPasteSheet() {
  const body = openSheet('Colar cronograma', `<form id="pasteForm" novalidate>
    <p class="hint">Cole aqui o texto do cronograma (começa com {"app":"gastos-viagem"...). Nada é salvo antes de você confirmar.</p>
    <textarea id="pText" rows="10" spellcheck="false" autocapitalize="off" autocorrect="off" placeholder='{"app":"gastos-viagem","kind":"cronograma",...}'></textarea>
    <div id="pErr" class="error" role="alert" hidden></div>
    <button class="btn primary" type="submit">Continuar</button></form>`);
  body.querySelector('form').onsubmit = async (ev) => {
    ev.preventDefault();
    const text = $('pText').value.trim();
    if (!text) { showErrors($('pErr'), ['Cole o texto do cronograma.']); return; }
    if (text.length > 1024 * 1024) { showErrors($('pErr'), ['O texto deve ter menos de 1 MB.']); return; }
    const r = parseScheduleImport(text, { people: S.people, existing: [], uid, now: new Date() });
    if (!r.ok) { showErrors($('pErr'), r.errors); return; }
    closeSheet();
    await importScheduleText(text);
  };
}

async function importScheduleText(text) {
  const r = parseScheduleImport(text, { people: S.people, existing: S.activities, uid, now: new Date() });
  if (!r.ok) {
    await confirmDialog({ title: 'Cronograma inválido', message: `Nada foi alterado.<ul>${r.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`, okLabel: 'Entendi' });
    return;
  }
  const sm = r.summary;
  if (sm.count === 0) {
    await confirmDialog({ title: 'Nada para importar', message: `As ${sm.skipped} atividade(s) do arquivo já existem (mesma data e título). Nada foi alterado.`, okLabel: 'Ok' });
    return;
  }
  const outside = r.activities.filter((a) => diffDays(a.date, S.trip.start) < 0 || diffDays(a.date, S.trip.end) > 0).length;
  const ok = await confirmDialog({
    title: 'Importar cronograma?',
    message: `<p><strong>${sm.count} atividade(s)</strong>, de ${formatDateBR(sm.first)} a ${formatDateBR(sm.last)}.</p>
      ${sm.skipped ? `<p>${sm.skipped} já existia(m) (mesma data e título) e será(ão) ignorada(s).</p>` : ''}
      ${outside ? `<p><strong>${outside}</strong> ficam fora do período da viagem (${formatDateBR(S.trip.start)} a ${formatDateBR(S.trip.end)}). Ajuste as datas da viagem em Ajustes se necessário.</p>` : ''}
      ${sm.unpriced ? `<p>${sm.unpriced} entram <strong>sem valor previsto</strong>: nada é inventado, você preenche depois.</p>` : ''}
      <p>Nada que já existe será apagado.</p>`,
    okLabel: 'Importar',
  });
  if (!ok) return;
  try {
    await db.putActivities(r.activities);
    S.activities = [...S.activities, ...r.activities];
    view = 'crono'; tlAnimate = true; render(); window.scrollTo(0, 0); toast(`${sm.count} atividades importadas`);
  } catch { await confirmDialog({ title: 'Falha ao importar', message: 'Nada foi alterado. Tente novamente.', okLabel: 'Ok' }); }
}

function openActivitySheet(id, presetDate) {
  const a = id ? S.activities.find((x) => x.id === id) : null;
  const cur = S.trip.currency;
  const order = S.people.map((p) => p.id);
  const dflt = () => { const t = todayLocal(); return diffDays(t, S.trip.start) < 0 ? S.trip.start : (diffDays(t, S.trip.end) > 0 ? S.trip.end : t); };
  const f = {
    mode: a ? a.splitMode : 'equal',
    selected: new Set(a ? a.participants : []),
    custom: a && a.splitMode === 'custom' ? Object.fromEntries(a.shares.map((s) => [s.personId, { min: formatPlain(s.min, cur), max: formatPlain(s.max, cur) }])) : {},
    icon: a?.icon ?? '',
    iconPicked: Boolean(a?.icon),
  };
  const F = a ? getForecast() : null;
  const info = a ? `<div class="card" style="margin-top:14px"><div class="kv"><span>Já gasto (vinculado)</span><b>${fmt(F.perActivity[a.id].spent)}</b></div>
      ${a.status === 'planned' && isPriced(a) ? `<div class="kv"><span>Ainda previsto</span><b>${range(F.perActivity[a.id].remMin, F.perActivity[a.id].remMax)}</b></div>` : ''}
      ${a.status !== 'planned' ? '<div class="hint">Atividade encerrada: sem previsão restante.</div>' : ''}
      <button class="btn" type="button" id="aAddExp">Registrar gasto desta atividade</button></div>` : '';
  const body = openSheet(a ? 'Editar atividade' : 'Nova atividade', `<form id="actForm" novalidate>
    <label>Atividade<input id="aTitle" maxlength="80" autocomplete="off" placeholder="Ex.: Parque, compras, jantar" value="${esc(a?.title ?? '')}"></label>
    <fieldset><legend>Ícone</legend><div id="iconBox" class="icons"></div></fieldset>
    <label>Dia<input id="aDate" type="date" value="${a ? a.date : (presetDate || dflt())}"></label>
    <label>Status<select id="aStatus">${optionsHtml(ACTIVITY_STATUS, a?.status ?? 'planned', 'id', 'label')}</select></label>
    <div class="two"><label>Mínimo (${esc(cur)})<input id="aMin" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${a && isPriced(a) ? esc(formatPlain(a.min, cur)) : ''}"></label>
      <label>Máximo (${esc(cur)})<input id="aMax" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${a && isPriced(a) ? esc(formatPlain(a.max, cur)) : ''}"></label></div>
    <p class="hint">Informe os valores que você estimou. Se ainda não sabe, deixe os dois vazios: a atividade fica "sem valor previsto" e não entra na previsão. O app não inventa preços.</p>
    <fieldset><legend>Quem participa?</legend><div id="splitBox"></div></fieldset>
    <label>Observações (opcional)<textarea id="aNotes" maxlength="600" rows="3">${esc(a?.notes ?? '')}</textarea></label>
    ${info}
    <div id="aErr" class="error" role="alert" hidden></div>
    <button class="btn primary" type="submit">Salvar atividade</button>
    ${a ? '<button class="btn danger" type="button" id="aDel">Excluir atividade</button>' : ''}</form>`);
  const form = body.querySelector('form');
  const box = $('splitBox');

  const customParsed = () => Object.fromEntries(order.map((i) => [i, f.custom[i] ? { min: parseMoney(f.custom[i].min ?? '', cur), max: parseMoney(f.custom[i].max ?? '', cur) } : null]));
  // valores digitados: undefined = erro; null/null = vazio (sem valor previsto)
  const readValues = () => {
    const sMin = $('aMin').value.trim(); const sMax = $('aMax').value.trim();
    if (!sMin && !sMax) return { empty: true, min: null, max: null };
    return { empty: false, min: sMin ? parseMoney(sMin, cur) : null, max: sMax ? parseMoney(sMax, cur) : null };
  };

  function renderIcons() {
    const shown = f.icon || suggestIcon($('aTitle').value);
    $('iconBox').innerHTML = ICON_CHOICES.map((e) => `<button type="button" class="chip ico-btn ${e === shown ? 'on' : ''}" data-icon="${esc(e)}" aria-pressed="${e === shown}" aria-label="Ícone ${esc(e)}">${esc(e)}</button>`).join('')
      + `<p class="hint" style="width:100%">${f.iconPicked ? 'Ícone escolhido por você.' : 'Sugestão automática pelo nome; toque para trocar.'}</p>`;
  }

  function renderSplit() {
    const chips = S.people.map((p) => `<button type="button" class="chip ${f.selected.has(p.id) ? 'on' : ''}" data-pid="${p.id}" aria-pressed="${f.selected.has(p.id)}">${esc(p.name)}</button>`).join('');
    const sel = S.people.filter((p) => f.selected.has(p.id));
    const rows = sel.map((p) => (f.mode === 'equal'
      ? `<div class="row"><span>${esc(p.name)}</span><strong data-prev="${p.id}">—</strong></div>`
      : `<div class="row"><span>${esc(p.name)}</span><span class="pair">
          <input class="cust" data-cid="${p.id}" data-k="min" inputmode="decimal" autocomplete="off" placeholder="mín." value="${esc(f.custom[p.id]?.min ?? '')}" aria-label="Mínimo de ${esc(p.name)}">
          <input class="cust" data-cid="${p.id}" data-k="max" inputmode="decimal" autocomplete="off" placeholder="máx." value="${esc(f.custom[p.id]?.max ?? '')}" aria-label="Máximo de ${esc(p.name)}"></span></div>`)).join('');
    box.innerHTML = `<div class="chips">${chips}<button type="button" class="chip" data-all>Todos</button></div>
      <div class="seg"><button type="button" data-mode="equal" class="${f.mode === 'equal' ? 'on' : ''}">Dividir igualmente</button>
      <button type="button" data-mode="custom" class="${f.mode === 'custom' ? 'on' : ''}">Personalizada</button></div>
      ${sel.length ? rows : '<p class="hint">Toque nas pessoas que participam. Nada é escolhido automaticamente.</p>'}
      <p id="splitSum" class="hint"></p><p id="splitSum2" class="hint"></p>`;
    updatePreview();
  }

  function updatePreview() {
    const v = readValues();
    const s1 = $('splitSum'); const s2 = $('splitSum2');
    if (!s1) return;
    s1.textContent = ''; s2.textContent = ''; s1.className = 'hint'; s2.className = 'hint';
    if (f.mode === 'equal') {
      const r = !v.empty && v.min !== null && v.max !== null ? buildShares({ mode: 'equal', min: v.min, max: v.max, order, selected: f.selected }) : { ok: false };
      box.querySelectorAll('[data-prev]').forEach((el) => {
        const sh = r.ok ? r.shares.find((x) => x.personId === el.dataset.prev) : null;
        el.textContent = sh ? range(sh.min, sh.max) : '—';
      });
    } else if (f.selected.size) {
      const vals = customParsed();
      const ids = order.filter((i) => f.selected.has(i));
      const sMin = ids.reduce((acc, i) => acc + (vals[i]?.min ?? 0), 0);
      const sMax = ids.reduce((acc, i) => acc + (vals[i]?.max ?? 0), 0);
      const line = (el, lb, sumV, total) => {
        if (total === null) { el.textContent = `${lb}: soma ${fmt(sumV)}`; return; }
        const diff = total - sumV;
        el.textContent = diff === 0 ? `${lb}: soma ${fmt(sumV)} = total ✔` : `${lb}: soma ${fmt(sumV)} de ${fmt(total)} · ${diff > 0 ? 'faltam' : 'passou'} ${fmt(Math.abs(diff))}`;
        el.className = diff === 0 ? 'hint pos' : 'hint neg';
      };
      line(s1, 'Mínimo', sMin, v.min); line(s2, 'Máximo', sMax, v.max);
    }
  }

  form.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.icon) { f.icon = b.dataset.icon; f.iconPicked = true; renderIcons(); }
    else if (b.dataset.pid) { f.selected.has(b.dataset.pid) ? f.selected.delete(b.dataset.pid) : f.selected.add(b.dataset.pid); renderSplit(); }
    else if (b.hasAttribute('data-all')) { order.forEach((i) => f.selected.add(i)); renderSplit(); }
    else if (b.dataset.mode) { f.mode = b.dataset.mode; renderSplit(); }
  });
  form.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.id === 'aMin' || el.id === 'aMax') updatePreview();
    else if (el.id === 'aTitle') { if (!f.iconPicked) renderIcons(); }
    else if (el.dataset.cid) { (f.custom[el.dataset.cid] ??= {})[el.dataset.k] = el.value; updatePreview(); }
  });

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const errors = [];
    const title = $('aTitle').value.trim();
    const date = $('aDate').value;
    const v = readValues();
    if (!title) errors.push('Informe o nome da atividade.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('Informe o dia.');
    let shares = null;
    if (!v.empty && (v.min === null || v.max === null)) errors.push('Preencha mínimo e máximo, ou deixe os dois vazios (sem valor previsto).');
    else {
      if (v.empty && f.mode === 'custom') errors.push('A divisão personalizada precisa de mínimo e máximo. Use "Dividir igualmente" ou informe os valores.');
      const r = errors.length ? { ok: false, code: 'skip' } : buildShares({ mode: v.empty ? 'equal' : f.mode, min: v.min, max: v.max, order, selected: f.selected, custom: customParsed() });
      const nm = (pid) => S.people.find((p) => p.id === pid)?.name ?? '';
      if (r.ok) shares = r.shares;
      else if (r.code === 'min_gt_max') errors.push('O mínimo não pode ser maior que o máximo.');
      else if (r.code === 'no_participant') errors.push('Escolha quem participa (uma ou mais pessoas).');
      else if (r.code === 'missing_value') errors.push(`Informe mínimo e máximo de ${nm(r.personId)} (pode ser 0,00).`);
      else if (r.code === 'person_min_gt_max') errors.push(`Para ${nm(r.personId)}, o mínimo não pode ser maior que o máximo.`);
      else if (r.code === 'sum_min_mismatch') errors.push(`A soma dos mínimos por pessoa não fecha com ${fmt(v.min)} (${r.diff > 0 ? 'faltam' : 'passou'} ${fmt(Math.abs(r.diff))}).`);
      else if (r.code === 'sum_max_mismatch') errors.push(`A soma dos máximos por pessoa não fecha com ${fmt(v.max)} (${r.diff > 0 ? 'faltam' : 'passou'} ${fmt(Math.abs(r.diff))}).`);
      else if (r.code === 'bad_values') errors.push('Mínimo e máximo inválidos.');
    }
    showErrors($('aErr'), errors);
    if (errors.length) return;
    const obj = {
      id: a?.id ?? uid(), date, title, status: $('aStatus').value, min: v.min, max: v.max, splitMode: v.empty ? 'equal' : f.mode,
      icon: f.icon || suggestIcon(title), notes: $('aNotes').value.trim(),
      participants: order.filter((i) => f.selected.has(i)), shares, createdAt: a?.createdAt ?? localTimestamp(),
    };
    try {
      await db.putActivity(obj);
      S.activities = a ? S.activities.map((x) => (x.id === obj.id ? obj : x)) : [...S.activities, obj];
      closeSheet(); render(); toast('Atividade salva');
    } catch { showErrors($('aErr'), ['Não foi possível salvar no aparelho. Tente de novo.']); }
  };
  const addExp = $('aAddExp');
  if (addExp) addExp.onclick = () => { closeSheet(); openExpenseSheet(null, { activityId: a.id }); };
  const del = $('aDel');
  if (del) del.onclick = async () => {
    const linked = S.expenses.filter((x) => x.activityId === a.id);
    const msg = linked.length
      ? `Os ${linked.length} gasto(s) vinculado(s) <strong>continuam lançados</strong> (o saldo não muda); só perdem o vínculo com a atividade.`
      : 'A atividade e a previsão dela serão removidas.';
    if (!await confirmDialog({ title: `Excluir "${a.title}"?`, message: msg, okLabel: 'Excluir', danger: true })) return;
    const unlinked = linked.map((x) => ({ ...x, activityId: null }));
    await db.deleteActivity(a.id, unlinked);
    S.activities = S.activities.filter((x) => x.id !== a.id);
    S.expenses = S.expenses.map((x) => (x.activityId === a.id ? { ...x, activityId: null } : x));
    closeSheet(); render(); toast('Atividade excluída');
  };
  renderIcons();
  renderSplit();
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
function openExpenseSheet(id, preset = {}) {
  const ex = id ? S.expenses.find((e) => e.id === id) : null;
  const cur = S.trip.currency;
  const order = S.people.map((p) => p.id);
  const f = {
    mode: ex ? ex.splitMode : 'equal',
    selected: new Set(ex ? ex.consumers.map((c) => c.personId) : []),
    custom: ex && ex.splitMode === 'custom' ? Object.fromEntries(ex.consumers.map((c) => [c.personId, formatPlain(c.cents, cur)])) : {},
  };
  const linkedId = ex ? (ex.activityId ?? '') : (preset.activityId ?? '');
  const actOptions = [...S.activities].filter((x) => x.status !== 'cancelled' || x.id === linkedId)
    .sort((p, q) => p.date.localeCompare(q.date) || p.title.localeCompare(q.title))
    .map((x) => `<option value="${esc(x.id)}" ${x.id === linkedId ? 'selected' : ''}>${esc(formatDateBR(x.date))} · ${esc(x.title)}${x.status === 'done' ? ' (concluída)' : ''}</option>`).join('');
  const actField = S.activities.length ? `<label>Atividade (opcional)<select id="fAct"><option value="">Sem atividade</option>${actOptions}</select></label>
    <p class="hint">Vinculado a uma atividade, o gasto reduz o que ainda resta da previsão dela (sem contar duas vezes).</p>` : '';
  const body = openSheet(ex ? 'Editar gasto' : 'Novo gasto', `<form id="expForm" novalidate>
    <label>Valor (${esc(cur)})<input id="fAmount" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${ex ? esc(formatPlain(ex.cents, cur)) : ''}"></label>
    <label>Data<input id="fDate" type="date" value="${ex ? ex.date : (preset.date || todayLocal())}"></label>
    <label>Loja / local (opcional)<input id="fStore" maxlength="80" autocomplete="off" value="${esc(ex?.store ?? '')}"></label>
    <label>Categoria<select id="fCat">${optionsHtml(CATEGORIES, ex?.category ?? 'alimentacao', 'id', 'label')}</select></label>
    <label>Descrição (opcional)<input id="fDesc" maxlength="200" autocomplete="off" value="${esc(ex?.description ?? '')}"></label>
    ${actField}
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
      activityId: $('fAct') ? ($('fAct').value || null) : (ex?.activityId ?? null),
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
  const atual = S.trip ? `<p>Dados atuais que serão <strong>apagados</strong>: ${esc(S.trip.name)} — ${S.entries.length} entrada(s), ${S.expenses.length} gasto(s), ${S.activities.length} atividade(s).</p>` : '';
  const ok = await confirmDialog({
    title: 'Restaurar este backup?',
    message: `${atual}<p>Backup: <strong>${esc(s.tripName)}</strong> (${formatDateBR(s.start)} a ${formatDateBR(s.end)}, ${esc(s.currency)}) — ${s.entries} entrada(s), ${s.expenses} gasto(s), ${s.activities} atividade(s)${s.exportedAt ? `, exportado em ${esc(s.exportedAt.replace('T', ' '))}` : ''}.</p><p>Isso <strong>sobrescreve tudo</strong> o que está no app agora.</p>`,
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
  if (el.dataset.tab) { view = el.dataset.tab; tlAnimate = view === 'crono'; render(); window.scrollTo(0, 0); return; }
  const act = el.dataset.act;
  if (act === 'new-expense') openExpenseSheet(null, { date: el.dataset.date });
  else if (act === 'edit-expense') openExpenseSheet(el.dataset.id);
  else if (act === 'new-entry') openEntrySheet(null);
  else if (act === 'edit-entry') openEntrySheet(el.dataset.id);
  else if (act === 'new-activity') openActivitySheet(null);
  else if (act === 'import-schedule') { $('schedPicker').value = ''; $('schedPicker').click(); }
  else if (act === 'paste-schedule') openPasteSheet();
  else if (act === 'bulk-price') openBulkPriceSheet();
  else if (act === 'set-status') setActivityStatus(el.dataset.id, el.dataset.status);
  else if (act === 'add-activity') openActivitySheet(null, el.dataset.date);
  else if (act === 'edit-activity') openActivitySheet(el.dataset.id);
  else if (act === 'goto') { view = el.dataset.view; tlAnimate = view === 'crono'; render(); window.scrollTo(0, 0); }
  else if (act === 'export') exportBackup();
  else if (act === 'restore') { $('filePicker').value = ''; $('filePicker').click(); }
});
$('filePicker').addEventListener('change', (ev) => handleRestoreFile(ev.target.files[0]));
$('schedPicker').addEventListener('change', (ev) => handleScheduleFile(ev.target.files[0]));
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
