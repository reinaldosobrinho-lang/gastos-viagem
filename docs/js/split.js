// Divisão de um gasto entre pessoas, sempre fechando no centavo.
import { sum } from './money.js';

/** Divide igualmente; os centavos que sobram vão para as primeiras pessoas, na ordem dada. */
export function splitEqual(total, personIds) {
  const n = personIds.length;
  if (n === 0) return [];
  const base = Math.floor(total / n);
  const rem = total - base * n;
  return personIds.map((personId, i) => ({ personId, cents: base + (i < rem ? 1 : 0) }));
}

const isMoney0 = (v) => Number.isSafeInteger(v) && v >= 0;

/**
 * Divide a previsão (mínimo e máximo) de uma atividade entre os participantes.
 * mode: 'equal' | 'custom'; custom: { id: { min, max } } em centavos (ou null se vazio).
 * Retorna { ok:true, shares:[{personId,min,max}] } ou { ok:false, code, personId?, diff? }.
 * min e max nulos (os dois) = atividade sem valor previsto: shares vazio.
 * Códigos: no_participant, bad_values, min_gt_max, bad_mode, missing_value,
 * person_min_gt_max, sum_min_mismatch, sum_max_mismatch.
 */
export function buildShares({ mode, min, max, order, selected, custom = {} }) {
  const ids = order.filter((id) => selected.has(id));
  if (ids.length === 0) return { ok: false, code: 'no_participant' };
  // Sem valor previsto ainda (os dois vazios): a atividade existe, mas não entra na previsão.
  if (min === null && max === null) return { ok: true, shares: [] };
  if (!isMoney0(min) || !isMoney0(max)) return { ok: false, code: 'bad_values' };
  if (min > max) return { ok: false, code: 'min_gt_max' };

  if (mode === 'equal') {
    const a = splitEqual(min, ids);
    const b = splitEqual(max, ids);
    return { ok: true, shares: ids.map((personId, i) => ({ personId, min: a[i].cents, max: b[i].cents })) };
  }
  if (mode !== 'custom') return { ok: false, code: 'bad_mode' };

  const shares = [];
  for (const id of ids) {
    const v = custom[id];
    if (!v || !isMoney0(v.min) || !isMoney0(v.max)) return { ok: false, code: 'missing_value', personId: id };
    if (v.min > v.max) return { ok: false, code: 'person_min_gt_max', personId: id };
    shares.push({ personId: id, min: v.min, max: v.max });
  }
  const sMin = sum(shares.map((s) => s.min));
  const sMax = sum(shares.map((s) => s.max));
  if (sMin !== min) return { ok: false, code: 'sum_min_mismatch', diff: min - sMin };
  if (sMax !== max) return { ok: false, code: 'sum_max_mismatch', diff: max - sMax };
  return { ok: true, shares };
}

/**
 * Monta as partes de um gasto.
 * mode: 'equal' | 'custom'; order: ids na ordem canônica; selected: Set de ids;
 * custom: { id: centavos|null } (só no modo 'custom').
 * Retorna { ok:true, consumers } ou { ok:false, code, diff?, sum?, personId? }.
 */
export function buildConsumers({ mode, total, order, selected, custom = {} }) {
  const ids = order.filter((id) => selected.has(id));
  if (ids.length === 0) return { ok: false, code: 'no_consumer' };
  if (!Number.isSafeInteger(total) || total <= 0) return { ok: false, code: 'bad_total' };

  if (mode === 'equal') return { ok: true, consumers: splitEqual(total, ids) };
  if (mode !== 'custom') return { ok: false, code: 'bad_mode' };

  const consumers = [];
  for (const id of ids) {
    const v = custom[id];
    if (!Number.isSafeInteger(v) || v <= 0) return { ok: false, code: 'missing_value', personId: id };
    consumers.push({ personId: id, cents: v });
  }
  const total2 = sum(consumers.map((c) => c.cents));
  if (total2 !== total) return { ok: false, code: 'sum_mismatch', sum: total2, diff: total - total2 };
  return { ok: true, consumers };
}
