// Exportação e validação de backup JSON. Só aceita dados que passem por validação completa;
// o resultado é reconstruído campo a campo (campos desconhecidos são descartados).
import { CATEGORIES, PERSON_IDS, ACTIVITY_STATUS } from './constants.js';
import { isValidDate, localTimestamp } from './dates.js';
import { sum } from './money.js';
import { validateTrip, validatePeopleNames } from './trip.js';

export const APP_ID = 'gastos-viagem';
export const SCHEMA_VERSION = 2; // sobe junto com DB_VERSION quando o formato mudar

export function buildBackup({ trip, people, entries, expenses, activities = [] }, now = new Date()) {
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
      activityId: x.activityId ?? null,
      consumers: x.consumers.map((c) => ({ personId: c.personId, cents: c.cents })),
    })),
    activities: activities.map((a) => ({
      id: a.id, date: a.date, title: a.title, status: a.status, min: a.min, max: a.max,
      splitMode: a.splitMode, createdAt: a.createdAt, participants: [...a.participants],
      shares: a.shares.map((s) => ({ personId: s.personId, min: s.min, max: s.max })),
    })),
  };
}

/** Migra backups antigos para o formato atual. */
export function migrateBackup(raw) {
  let r = raw;
  if (r.schema < 2) r = { ...r, schema: 2, activities: [] }; // schema 1 não tinha cronograma
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
    if (!isMoney0(a.min) || !isMoney0(a.max)) { errors.push(`${label}: mínimo/máximo inválidos.`); bad = true; }
    else if (a.min > a.max) { errors.push(`${label}: o mínimo é maior que o máximo.`); bad = true; }
    const participants = [];
    const shares = [];
    if (!Array.isArray(a.participants) || a.participants.length === 0
      || a.participants.some((p, k) => !personIds.has(p) || a.participants.indexOf(p) !== k)) {
      errors.push(`${label}: participantes inválidos.`); bad = true;
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
        id: a.id, date: a.date, title: a.title.trim(), status: a.status, min: a.min, max: a.max,
        splitMode: a.splitMode, createdAt: cleanTs(a.createdAt), participants, shares,
      });
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
        description: x.description ?? '', splitMode: x.splitMode, consumers, createdAt: cleanTs(x.createdAt), activityId,
      });
    }
  });

  if (errors.length) return { ok: false, errors: errors.slice(0, 12) };
  return {
    ok: true, errors: [],
    data: { trip: { ...trip, name: trip.name.trim() }, people, entries, expenses, activities },
    summary: { tripName: trip.name.trim(), start: trip.start, end: trip.end, currency: trip.currency,
      entries: entries.length, expenses: expenses.length, activities: activities.length, exportedAt: isStr(raw.exportedAt, 30) ? raw.exportedAt : '' },
  };
}
