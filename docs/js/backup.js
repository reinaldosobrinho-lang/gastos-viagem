// Exportação e validação de backup JSON. Só aceita dados que passem por validação completa;
// o resultado é reconstruído campo a campo (campos desconhecidos são descartados).
import { CATEGORIES, PERSON_IDS } from './constants.js';
import { isValidDate, localTimestamp } from './dates.js';
import { sum } from './money.js';
import { validateTrip, validatePeopleNames } from './trip.js';

export const APP_ID = 'gastos-viagem';
export const SCHEMA_VERSION = 1; // sobe junto com DB_VERSION quando o formato mudar

export function buildBackup({ trip, people, entries, expenses }, now = new Date()) {
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
      consumers: x.consumers.map((c) => ({ personId: c.personId, cents: c.cents })),
    })),
  };
}

/** Migra backups antigos para o formato atual. (Hoje só existe o schema 1.) */
export function migrateBackup(raw) {
  return raw;
}

const isStr = (v, max) => typeof v === 'string' && v.length <= max;
const isCents = (v) => Number.isSafeInteger(v) && v > 0 && v < 1e13;

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
        description: x.description ?? '', splitMode: x.splitMode, consumers, createdAt: cleanTs(x.createdAt),
      });
    }
  });

  if (errors.length) return { ok: false, errors: errors.slice(0, 12) };
  return {
    ok: true, errors: [],
    data: { trip: { ...trip, name: trip.name.trim() }, people, entries, expenses },
    summary: { tripName: trip.name.trim(), start: trip.start, end: trip.end, currency: trip.currency,
      entries: entries.length, expenses: expenses.length, exportedAt: isStr(raw.exportedAt, 30) ? raw.exportedAt : '' },
  };
}
