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
