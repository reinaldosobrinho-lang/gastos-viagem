// Importação de cronograma a partir de um arquivo JSON. Só ADICIONA atividades; nada existente é apagado.
// Formato:
// { "app": "gastos-viagem", "kind": "cronograma", "schema": 1,
//   "activities": [ { "date": "AAAA-MM-DD", "title": "...", "icon": "🏰", "notes": "...",
//                     "status": "planned", "min": 12000, "max": 20000, "participants": ["p1","p2"] } ] }
// min/max em centavos e opcionais (os dois ou nenhum). participants omitido = as 3 pessoas.
import { ACTIVITY_STATUS } from './constants.js';
import { isValidDate, localTimestamp } from './dates.js';
import { buildShares } from './split.js';
import { suggestIcon } from './icons.js';

export const IMPORT_KIND = 'cronograma';
const MAX_ITEMS = 300;
const isStr = (v, max) => typeof v === 'string' && v.length <= max;
const isMoney0 = (v) => Number.isSafeInteger(v) && v >= 0 && v < 1e13;
const key = (date, title) => `${date}|${title.trim().toLowerCase()}`;

/** Retorna { ok, errors, activities, summary } sem gravar nada. `uid` gera os ids; `existing` evita duplicatas. */
export function parseScheduleImport(input, { people, existing = [], uid, now = new Date() }) {
  let raw = input;
  if (typeof input === 'string') {
    try { raw = JSON.parse(input); } catch { return { ok: false, errors: ['O arquivo não é um JSON válido.'] }; }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.app !== 'gastos-viagem' || raw.kind !== IMPORT_KIND) {
    return { ok: false, errors: ['Este arquivo não é um cronograma deste app.'] };
  }
  if (raw.schema !== 1) return { ok: false, errors: ['Versão do arquivo de cronograma não suportada.'] };
  if (!Array.isArray(raw.activities) || raw.activities.length === 0) return { ok: false, errors: ['O arquivo não tem atividades.'] };
  if (raw.activities.length > MAX_ITEMS) return { ok: false, errors: [`Máximo de ${MAX_ITEMS} atividades por arquivo.`] };

  const order = people.map((p) => p.id);
  const errors = [];
  const seen = new Set(existing.map((a) => key(a.date, a.title)));
  const ts = localTimestamp(now);
  const activities = [];
  let skipped = 0;

  raw.activities.forEach((a, i) => {
    const label = `Item ${i + 1}`;
    if (!a || typeof a !== 'object') { errors.push(`${label}: inválido.`); return; }
    const title = typeof a.title === 'string' ? a.title.trim() : '';
    if (!isValidDate(a.date)) errors.push(`${label}: data inválida.`);
    if (!title || title.length > 80) errors.push(`${label}: título vazio ou maior que 80 caracteres.`);
    if (!isStr(a.icon ?? '', 16) || !isStr(a.notes ?? '', 600)) errors.push(`${label}: ícone ou observações inválidos.`);
    const status = a.status ?? 'planned';
    if (!ACTIVITY_STATUS.some((s) => s.id === status)) errors.push(`${label}: status inválido.`);
    const noMin = a.min === undefined || a.min === null;
    const noMax = a.max === undefined || a.max === null;
    if (noMin !== noMax) errors.push(`${label}: informe mínimo e máximo, ou nenhum dos dois.`);
    else if (!noMin && (!isMoney0(a.min) || !isMoney0(a.max) || a.min > a.max)) errors.push(`${label}: mínimo/máximo inválidos.`);
    const participants = a.participants ?? order;
    if (!Array.isArray(participants) || participants.length === 0
      || participants.some((p, k) => !order.includes(p) || participants.indexOf(p) !== k)) errors.push(`${label}: participantes inválidos.`);
    if (errors.length) return;

    if (seen.has(key(a.date, title))) { skipped += 1; return; } // mesma data e mesmo título: já existe
    seen.add(key(a.date, title));
    const sh = buildShares({
      mode: 'equal', min: noMin ? null : a.min, max: noMax ? null : a.max, order, selected: new Set(participants),
    });
    activities.push({
      id: uid(), date: a.date, title, status, min: noMin ? null : a.min, max: noMax ? null : a.max,
      icon: a.icon || suggestIcon(title), notes: a.notes ?? '', splitMode: 'equal',
      createdAt: `${ts}.${String(i).padStart(3, '0')}`, // preserva a ordem do arquivo dentro do dia
      participants: order.filter((p) => participants.includes(p)), shares: sh.shares,
    });
  });

  if (errors.length) return { ok: false, errors: errors.slice(0, 10) };
  const dates = activities.map((a) => a.date).sort();
  return {
    ok: true, errors: [], activities,
    summary: { count: activities.length, skipped, first: dates[0] ?? null, last: dates[dates.length - 1] ?? null,
      unpriced: activities.filter((a) => a.min === null).length },
  };
}
