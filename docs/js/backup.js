// Exportação e validação de backup JSON. Só aceita dados que passem por validação completa;
// o resultado é reconstruído campo a campo (campos desconhecidos são descartados).
import { CATEGORIES, PERSON_IDS, ACTIVITY_STATUS, CURRENCIES } from './constants.js';
import { isValidDate, localTimestamp } from './dates.js';
import { sum } from './money.js';
import { computeReceipt } from './receipt.js';
import { validateTrip, validatePeopleNames } from './trip.js';

export const APP_ID = 'gastos-viagem';
export const SCHEMA_VERSION = 3; // sobe junto com DB_VERSION quando o formato mudar

export function buildBackup({ trip, people, entries, expenses, activities = [], receipts = [] }, now = new Date()) {
  return {
    app: APP_ID,
    schema: SCHEMA_VERSION,
    exportedAt: localTimestamp(now),
    trip: { name: trip.name, start: trip.start, end: trip.end, currency: trip.currency },
    people: people.map((p) => ({ id: p.id, name: p.name })),
    entries: entries.map((e) => ({
      id: e.id, date: e.date, cents: e.cents, description: e.description, createdAt: e.createdAt,
    })),
    expenses: expenses.map((x) => ({
      id: x.id, date: x.date, cents: x.cents, store: x.store, category: x.category,
      description: x.description, splitMode: x.splitMode, createdAt: x.createdAt,
      activityId: x.activityId ?? null, receiptId: x.receiptId ?? null,
      consumers: x.consumers.map((c) => ({ personId: c.personId, cents: c.cents })),
    })),
    // As FOTOS das notas não entram no backup (ficam só no aparelho); os dados lançados entram.
    receipts: receipts.map((r) => ({
      id: r.id, status: r.status, createdAt: r.createdAt, store: r.store, date: r.date, currency: r.currency,
      category: r.category, activityId: r.activityId ?? null, expenseId: r.expenseId ?? null, hasPhoto: false,
      tipCents: r.tipCents ?? null, printedTotalCents: r.printedTotalCents ?? null, convertedTotalCents: r.convertedTotalCents ?? null,
      items: r.items.map((i) => ({ id: i.id, name: i.name, qty: i.qty, cents: i.cents ?? null, personIds: [...i.personIds], qtyBy: i.qtyBy ?? null })),
      taxes: r.taxes.map((t) => ({ name: t.name, cents: t.cents ?? null, included: Boolean(t.included) })),
      discounts: r.discounts.map((d) => ({ name: d.name, cents: d.cents ?? null })),
    })),
    activities: activities.map((a) => ({
      id: a.id, date: a.date, title: a.title, status: a.status, min: a.min ?? null, max: a.max ?? null,
      icon: a.icon ?? '', notes: a.notes ?? '',
      splitMode: a.splitMode, createdAt: a.createdAt, participants: [...a.participants],
      shares: a.shares.map((s) => ({ personId: s.personId, min: s.min, max: s.max })),
    })),
  };
}

/** Migra backups antigos para o formato atual. */
export function migrateBackup(raw) {
  let r = raw;
  if (r.schema < 2) r = { ...r, schema: 2, activities: [] }; // schema 1 não tinha cronograma
  if (r.schema < 3) r = { ...r, schema: 3, receipts: [] }; // schema 1-2 não tinham notas fiscais
  return r;
}

const isStr = (v, max) => typeof v === 'string' && v.length <= max;
const isCents = (v) => Number.isSafeInteger(v) && v > 0 && v < 1e13;
const isMoney0 = (v) => Number.isSafeInteger(v) && v >= 0 && v < 1e13;

/** Retorna { ok, errors, data?, summary? }. Aceita texto JSON ou objeto. */
export function validateBackup(input) {
  const errors = [];
  let raw = input;
  if (typeof input === 'string') {
    try { raw = JSON.parse(input); } catch { return { ok: false, errors: ['O arquivo não é um JSON válido.'] }; }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['Formato inesperado: não parece um backup deste app.'] };
  }
  if (raw.app !== APP_ID) return { ok: false, errors: ['Este arquivo não é um backup do app Gastos da Viagem.'] };
  if (!Number.isInteger(raw.schema) || raw.schema < 1) return { ok: false, errors: ['Versão do backup ausente ou inválida.'] };
  if (raw.schema > SCHEMA_VERSION) {
    return { ok: false, errors: ['Este backup é de uma versão mais nova do app. Atualize o app antes de restaurar.'] };
  }
  raw = migrateBackup(raw);

  // Viagem
  const trip = raw.trip && typeof raw.trip === 'object'
    ? { name: typeof raw.trip.name === 'string' ? raw.trip.name.trim() : raw.trip.name,
        start: raw.trip.start, end: raw.trip.end, currency: raw.trip.currency }
    : null;
  errors.push(...validateTrip(trip));

  // Pessoas
  let people = [];
  if (!Array.isArray(raw.people) || raw.people.length !== 3) {
    errors.push('O backup deve ter exatamente 3 pessoas.');
  } else {
    const ids = raw.people.map((p) => p && p.id);
    if (!PERSON_IDS.every((id, i) => ids[i] === id)) errors.push('Identificadores das pessoas inválidos.');
    errors.push(...validatePeopleNames(raw.people.map((p) => p && p.name)));
    people = raw.people.map((p) => ({ id: p?.id, name: typeof p?.name === 'string' ? p.name.trim() : '' }));
  }
  const personIds = new Set(people.map((p) => p.id));

  const seen = new Set();
  const dupId = (id, label) => {
    if (typeof id !== 'string' || !id || id.length > 64) { errors.push(`${label}: identificador inválido.`); return true; }
    if (seen.has(id)) { errors.push(`${label}: identificador repetido.`); return true; }
    seen.add(id);
    return false;
  };
  const cleanTs = (v) => (isStr(v, 30) ? v : '');

  // Entradas
  const entries = [];
  if (!Array.isArray(raw.entries)) errors.push('Lista de entradas de saldo ausente.');
  else raw.entries.forEach((e, i) => {
    const label = `Entrada ${i + 1}`;
    if (!e || typeof e !== 'object') { errors.push(`${label}: inválida.`); return; }
    let bad = dupId(e.id, label);
    if (!isValidDate(e.date)) { errors.push(`${label}: data inválida.`); bad = true; }
    if (!isCents(e.cents)) { errors.push(`${label}: valor inválido.`); bad = true; }
    if (!isStr(e.description ?? '', 200)) { errors.push(`${label}: descrição inválida.`); bad = true; }
    if (!bad) entries.push({ id: e.id, date: e.date, cents: e.cents, description: e.description ?? '', createdAt: cleanTs(e.createdAt) });
  });

  // Atividades (cronograma)
  const activities = [];
  const activityIds = new Set();
  if (!Array.isArray(raw.activities)) errors.push('Lista de atividades ausente.');
  else raw.activities.forEach((a, i) => {
    const label = `Atividade ${i + 1}`;
    if (!a || typeof a !== 'object') { errors.push(`${label}: inválida.`); return; }
    let bad = dupId(a.id, label);
    if (!isValidDate(a.date)) { errors.push(`${label}: data inválida.`); bad = true; }
    if (typeof a.title !== 'string' || !a.title.trim() || a.title.length > 80) { errors.push(`${label}: título inválido.`); bad = true; }
    if (!ACTIVITY_STATUS.some((s) => s.id === a.status)) { errors.push(`${label}: status inválido.`); bad = true; }
    if (a.splitMode !== 'equal' && a.splitMode !== 'custom') { errors.push(`${label}: modo de divisão inválido.`); bad = true; }
    const noMin = a.min === null || a.min === undefined;
    const noMax = a.max === null || a.max === undefined;
    const unpriced = noMin && noMax; // sem valor previsto ainda
    if (noMin !== noMax) { errors.push(`${label}: informe mínimo e máximo, ou nenhum dos dois.`); bad = true; }
    else if (!unpriced && (!isMoney0(a.min) || !isMoney0(a.max))) { errors.push(`${label}: mínimo/máximo inválidos.`); bad = true; }
    else if (!unpriced && a.min > a.max) { errors.push(`${label}: o mínimo é maior que o máximo.`); bad = true; }
    if (!isStr(a.icon ?? '', 16) || !isStr(a.notes ?? '', 600)) { errors.push(`${label}: ícone ou observações inválidos.`); bad = true; }
    const participants = [];
    const shares = [];
    if (!Array.isArray(a.participants) || a.participants.length === 0
      || a.participants.some((p, k) => !personIds.has(p) || a.participants.indexOf(p) !== k)) {
      errors.push(`${label}: participantes inválidos.`); bad = true;
    } else if (unpriced) {
      participants.push(...a.participants);
      if (Array.isArray(a.shares) && a.shares.length) { errors.push(`${label}: divisão da previsão sem valor previsto.`); bad = true; }
    } else if (!Array.isArray(a.shares) || a.shares.length !== a.participants.length) {
      errors.push(`${label}: divisão da previsão inválida.`); bad = true;
    } else {
      participants.push(...a.participants);
      for (const s of a.shares) {
        if (!s || !participants.includes(s.personId) || shares.some((q) => q.personId === s.personId)
          || !isMoney0(s.min) || !isMoney0(s.max) || s.min > s.max) {
          errors.push(`${label}: divisão da previsão inválida.`); bad = true; break;
        }
        shares.push({ personId: s.personId, min: s.min, max: s.max });
      }
      if (!bad && (sum(shares.map((s) => s.min)) !== a.min || sum(shares.map((s) => s.max)) !== a.max)) {
        errors.push(`${label}: a soma da previsão por pessoa não bate com o mínimo/máximo.`); bad = true;
      }
    }
    if (!bad) {
      activityIds.add(a.id);
      activities.push({
        id: a.id, date: a.date, title: a.title.trim(), status: a.status, min: unpriced ? null : a.min, max: unpriced ? null : a.max,
        icon: a.icon ?? '', notes: a.notes ?? '',
        splitMode: a.splitMode, createdAt: cleanTs(a.createdAt), participants, shares,
      });
    }
  });

  // Notas fiscais (sem fotos)
  const receipts = [];
  const receiptIds = new Set();
  const confirmed = [];
  const tripCur = trip && trip.currency;
  if (!Array.isArray(raw.receipts)) errors.push('Lista de notas fiscais ausente.');
  else raw.receipts.forEach((r, i) => {
    const label = `Nota ${i + 1}`;
    if (!r || typeof r !== 'object') { errors.push(`${label}: inválida.`); return; }
    let bad = dupId(r.id, label);
    const nullOr = (v, f) => v === null || v === undefined || f(v);
    if (r.status !== 'pending' && r.status !== 'confirmed') { errors.push(`${label}: status inválido.`); bad = true; }
    if (!isStr(r.store ?? '', 80)) { errors.push(`${label}: loja inválida.`); bad = true; }
    if (!(r.date === '' || r.date === undefined || isValidDate(r.date))) { errors.push(`${label}: data inválida.`); bad = true; }
    if (!CURRENCIES.some((c) => c.code === r.currency)) { errors.push(`${label}: moeda inválida.`); bad = true; }
    if (!CATEGORIES.some((c) => c.id === r.category)) { errors.push(`${label}: categoria inválida.`); bad = true; }
    if (!nullOr(r.tipCents, isMoney0) || !nullOr(r.printedTotalCents, isMoney0) || !nullOr(r.convertedTotalCents, isMoney0)) { errors.push(`${label}: valores inválidos.`); bad = true; }
    const items = [];
    if (!Array.isArray(r.items) || r.items.length > 200) { errors.push(`${label}: itens inválidos.`); bad = true; }
    else {
      for (const it of r.items) {
        const okIt = it && isStr(it.id, 64) && it.id && isStr(it.name ?? '', 80) && Number.isInteger(it.qty) && it.qty >= 1 && it.qty <= 999
          && nullOr(it.cents, isCents) && Array.isArray(it.personIds) && it.personIds.every((p, k) => personIds.has(p) && it.personIds.indexOf(p) === k)
          && (it.qtyBy === null || it.qtyBy === undefined || (typeof it.qtyBy === 'object' && Object.entries(it.qtyBy).every(([p, n]) => it.personIds.includes(p) && Number.isInteger(n) && n >= 0 && n <= 999)));
        if (!okIt) { errors.push(`${label}: item inválido.`); bad = true; break; }
        items.push({ id: it.id, name: it.name ?? '', qty: it.qty, cents: it.cents ?? null, personIds: [...it.personIds], qtyBy: it.qtyBy ? { ...it.qtyBy } : null });
      }
    }
    const taxes = [];
    const discounts = [];
    if (!Array.isArray(r.taxes) || r.taxes.length > 20 || !Array.isArray(r.discounts) || r.discounts.length > 20) { errors.push(`${label}: impostos/descontos inválidos.`); bad = true; }
    else {
      for (const t of r.taxes) {
        if (!t || !isStr(t.name ?? '', 40) || !nullOr(t.cents, isCents) || typeof t.included !== 'boolean') { errors.push(`${label}: imposto inválido.`); bad = true; break; }
        taxes.push({ name: t.name ?? '', cents: t.cents ?? null, included: t.included });
      }
      for (const d of r.discounts) {
        if (!d || !isStr(d.name ?? '', 40) || !nullOr(d.cents, isCents)) { errors.push(`${label}: desconto inválido.`); bad = true; break; }
        discounts.push({ name: d.name ?? '', cents: d.cents ?? null });
      }
    }
    if (r.activityId !== null && r.activityId !== undefined && !activityIds.has(r.activityId)) { errors.push(`${label}: vinculada a uma atividade que não existe.`); bad = true; }
    if (r.status === 'pending' && r.expenseId) { errors.push(`${label}: nota pendente não pode ter gasto.`); bad = true; }
    let finalTotal = null;
    let consumers = null;
    if (!bad && r.status === 'confirmed') {
      if (typeof r.expenseId !== 'string' || !r.expenseId) { errors.push(`${label}: nota confirmada sem gasto.`); bad = true; }
      else {
        const c = computeReceipt({ items, taxes, discounts, tipCents: r.tipCents ?? null, printedTotalCents: r.printedTotalCents ?? null,
          convertedTotalCents: r.convertedTotalCents ?? null, foreign: r.currency !== tripCur, order: [...personIds] });
        if (!c.ok) { errors.push(`${label}: as partes não fecham com o total.`); bad = true; }
        else { finalTotal = c.finalTotal; consumers = c.consumers; }
      }
    }
    if (!bad) {
      receiptIds.add(r.id);
      receipts.push({
        id: r.id, status: r.status, createdAt: cleanTs(r.createdAt), store: r.store ?? '', date: r.date ?? '', currency: r.currency,
        category: r.category, activityId: r.activityId ?? null, expenseId: r.status === 'confirmed' ? r.expenseId : null, hasPhoto: false,
        tipCents: r.tipCents ?? null, printedTotalCents: r.printedTotalCents ?? null, convertedTotalCents: r.convertedTotalCents ?? null,
        items, taxes, discounts,
      });
      if (r.status === 'confirmed') confirmed.push({ id: r.id, expenseId: r.expenseId, finalTotal, consumers, label });
    }
  });

  // Gastos
  const expenses = [];
  if (!Array.isArray(raw.expenses)) errors.push('Lista de gastos ausente.');
  else raw.expenses.forEach((x, i) => {
    const label = `Gasto ${i + 1}`;
    if (!x || typeof x !== 'object') { errors.push(`${label}: inválido.`); return; }
    let bad = dupId(x.id, label);
    if (!isValidDate(x.date)) { errors.push(`${label}: data inválida.`); bad = true; }
    if (!isCents(x.cents)) { errors.push(`${label}: valor inválido.`); bad = true; }
    if (!isStr(x.store ?? '', 80) || !isStr(x.description ?? '', 200)) { errors.push(`${label}: texto inválido.`); bad = true; }
    if (!CATEGORIES.some((c) => c.id === x.category)) { errors.push(`${label}: categoria inválida.`); bad = true; }
    if (x.splitMode !== 'equal' && x.splitMode !== 'custom') { errors.push(`${label}: modo de divisão inválido.`); bad = true; }
    const activityId = x.activityId ?? null;
    if (activityId !== null && !activityIds.has(activityId)) { errors.push(`${label}: vinculado a uma atividade que não existe.`); bad = true; }
    const receiptId = x.receiptId ?? null;
    if (receiptId !== null && !receiptIds.has(receiptId)) { errors.push(`${label}: vinculado a uma nota que não existe.`); bad = true; }
    let consumers = [];
    if (!Array.isArray(x.consumers) || x.consumers.length === 0) {
      errors.push(`${label}: sem consumidores.`); bad = true;
    } else {
      const used = new Set();
      for (const c of x.consumers) {
        if (!c || !personIds.has(c.personId) || used.has(c.personId)
          || !Number.isSafeInteger(c.cents) || c.cents < 0) {
          errors.push(`${label}: consumidor inválido.`); bad = true; break;
        }
        used.add(c.personId);
        consumers.push({ personId: c.personId, cents: c.cents });
      }
      if (!bad && sum(consumers.map((c) => c.cents)) !== x.cents) {
        errors.push(`${label}: a soma das partes não bate com o total.`); bad = true;
      }
    }
    if (!bad) {
      expenses.push({
        id: x.id, date: x.date, cents: x.cents, store: x.store ?? '', category: x.category,
        description: x.description ?? '', splitMode: x.splitMode, consumers, createdAt: cleanTs(x.createdAt), activityId, receiptId,
      });
    }
  });

  // Cada nota confirmada deve ter exatamente UM gasto, igual ao rateio calculado
  for (const c of confirmed) {
    const ex = expenses.find((x) => x.id === c.expenseId);
    const sameParts = ex && ex.consumers.filter((p) => p.cents > 0).length === c.consumers.length
      && c.consumers.every((p) => ex.consumers.find((q) => q.personId === p.personId)?.cents === p.cents);
    if (!ex || ex.receiptId !== c.id || ex.cents !== c.finalTotal || !sameParts) errors.push(`${c.label}: o gasto lançado não confere com a nota.`);
  }
  for (const x of expenses) {
    if (x.receiptId && confirmed.filter((c) => c.expenseId === x.id).length !== 1) errors.push('Um gasto vinculado a nota não tem a nota correspondente.');
  }

  if (errors.length) return { ok: false, errors: errors.slice(0, 12) };
  return {
    ok: true, errors: [],
    data: { trip: { ...trip, name: trip.name.trim() }, people, entries, expenses, activities, receipts },
    summary: { tripName: trip.name.trim(), start: trip.start, end: trip.end, currency: trip.currency,
      entries: entries.length, expenses: expenses.length, activities: activities.length, receipts: receipts.length, exportedAt: isStr(raw.exportedAt, 30) ? raw.exportedAt : '' },
  };
}
