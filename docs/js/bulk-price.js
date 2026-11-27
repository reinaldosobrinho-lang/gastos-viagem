// Preenchimento de valores em lote para atividades sem valor previsto (puro, testável).
// values: { [id]: { min: 'texto', max: 'texto' } } como digitado; parse: texto -> centavos | null.
// per: 'total' (valor da atividade inteira) | 'person' (valor por pessoa, multiplicado pelos participantes).
import { buildShares } from './split.js';

export function applyBulkPrices({ activities, values, per, order, parse }) {
  const errors = [];
  const updated = [];
  let totalMin = 0;
  let totalMax = 0;
  for (const a of activities) {
    const v = values[a.id];
    const sMin = (v?.min ?? '').trim();
    const sMax = (v?.max ?? '').trim();
    if (!sMin && !sMax) continue; // deixado em branco: continua sem valor previsto
    const min = sMin ? parse(sMin) : null;
    const max = sMax ? parse(sMax) : null;
    if (min === null || max === null) { errors.push(`"${a.title}": preencha mínimo e máximo válidos, ou deixe os dois vazios.`); continue; }
    if (min > max) { errors.push(`"${a.title}": o mínimo não pode ser maior que o máximo.`); continue; }
    const mult = per === 'person' ? a.participants.length : 1;
    const tMin = min * mult;
    const tMax = max * mult;
    if (!Number.isSafeInteger(tMin) || !Number.isSafeInteger(tMax) || tMax >= 1e13) { errors.push(`"${a.title}": valor grande demais.`); continue; }
    const r = buildShares({ mode: 'equal', min: tMin, max: tMax, order, selected: new Set(a.participants) });
    if (!r.ok) { errors.push(`"${a.title}": não foi possível dividir entre os participantes.`); continue; }
    updated.push({ ...a, min: tMin, max: tMax, splitMode: 'equal', shares: r.shares });
    totalMin += tMin; totalMax += tMax;
  }
  if (errors.length) return { ok: false, errors: errors.slice(0, 8) };
  return { ok: true, updated, total: { min: totalMin, max: totalMax } };
}
