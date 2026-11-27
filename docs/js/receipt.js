// Nota fiscal: rateio e validação (puro, testável). Tudo em centavos inteiros.
//
// Regras:
// - Cada item vale `cents` (valor da linha na nota) e é dividido entre as pessoas escolhidas:
//   igualmente, ou por quantidade (qtyBy: soma = qty do item).
// - Impostos "adicionados", descontos e gorjeta são rateados proporcionalmente ao subtotal de cada pessoa.
// - Imposto "já incluído no preço" é só informativo: NÃO entra no total nem no rateio (evita contar duas vezes).
// - Total calculado = soma dos itens + impostos adicionados + gorjeta - descontos. Precisa bater com o total impresso.
// - Se a moeda da nota difere da viagem, o valor convertido (informado por você) é rateado
//   proporcionalmente às partes calculadas na moeda da nota.
import { sum } from './money.js';

/** Reparte `total` proporcionalmente a `weights` (inteiros >= 0, soma > 0), fechando no centavo (maiores restos). */
export function allocate(total, weights) {
  const w = weights.map((x) => BigInt(x));
  const W = w.reduce((a, b) => a + b, 0n);
  if (W === 0n) throw new RangeError('A soma dos pesos é zero.');
  const T = BigInt(total);
  const base = w.map((x) => (T * x) / W);
  const rem = w.map((x) => (T * x) % W);
  const left = Number(T - base.reduce((a, b) => a + b, 0n));
  const out = base.map(Number);
  const idx = rem.map((_, i) => i).sort((a, b) => (rem[b] > rem[a] ? 1 : rem[b] < rem[a] ? -1 : a - b));
  for (let k = 0; k < left; k++) out[idx[k]] += 1;
  return out;
}

const isCents = (v) => Number.isSafeInteger(v) && v > 0 && v < 1e13;

/**
 * items: [{ cents, qty, personIds, qtyBy|null }]; taxes: [{ cents|null, included }]; discounts: [{ cents|null }].
 * tipCents: null|int; printedTotalCents: null|int; convertedTotalCents: null|int; foreign: moeda da nota != da viagem.
 * order: ids das pessoas em ordem canônica.
 * Retorna { ok, errors:[{code,...}], subtotal, taxAdded, taxIncluded, discount, tip, computedTotal, diff,
 *           personShares:{id:cents}|null (moeda da nota), consumers:[{personId,cents}]|null (moeda da viagem), finalTotal|null }.
 * Códigos: no_items, item_price, item_qty, item_unassigned, item_qty_value, item_qty_sum, line_value,
 *          discount_exceeds, no_printed_total, total_mismatch, no_converted.
 */
export function computeReceipt({ items, taxes = [], discounts = [], tipCents = null, printedTotalCents = null, convertedTotalCents = null, foreign = false, order }) {
  const errors = [];
  const err = (code, extra = {}) => errors.push({ code, ...extra });
  if (!items.length) err('no_items');

  const itemShares = [];
  let itemsOk = items.length > 0;
  items.forEach((it, index) => {
    let ok = true;
    if (!isCents(it.cents)) { err('item_price', { index }); ok = false; }
    if (!Number.isInteger(it.qty) || it.qty < 1 || it.qty > 999) { err('item_qty', { index }); ok = false; }
    const ids = order.filter((id) => it.personIds.includes(id));
    if (!ids.length) { err('item_unassigned', { index }); ok = false; }
    let weights = ids.map(() => 1);
    if (ok && it.qtyBy) {
      weights = ids.map((id) => it.qtyBy[id]);
      if (weights.some((x) => !Number.isInteger(x) || x < 1)) { err('item_qty_value', { index }); ok = false; }
      else if (sum(weights) !== it.qty) { err('item_qty_sum', { index, a: sum(weights), b: it.qty }); ok = false; }
    }
    if (!ok) { itemsOk = false; itemShares.push(null); return; }
    const parts = allocate(it.cents, weights);
    itemShares.push(ids.map((personId, k) => ({ personId, cents: parts[k] })));
  });

  const subtotal = sum(items.filter((it) => isCents(it.cents)).map((it) => it.cents));
  let linesOk = true;
  taxes.forEach((t, index) => { if (!isCents(t.cents)) { err('line_value', { kind: 'tax', index }); linesOk = false; } });
  discounts.forEach((d, index) => { if (!isCents(d.cents)) { err('line_value', { kind: 'discount', index }); linesOk = false; } });
  const taxAdded = sum(taxes.filter((t) => !t.included && isCents(t.cents)).map((t) => t.cents));
  const taxIncluded = sum(taxes.filter((t) => t.included && isCents(t.cents)).map((t) => t.cents));
  const discount = sum(discounts.filter((d) => isCents(d.cents)).map((d) => d.cents));
  const tip = tipCents ?? 0;
  if (discount > subtotal) err('discount_exceeds');

  const computedTotal = subtotal + taxAdded + tip - discount;
  let diff = null;
  if (printedTotalCents === null) err('no_printed_total');
  else {
    diff = printedTotalCents - computedTotal;
    if (diff !== 0) err('total_mismatch', { diff });
  }
  if (foreign && !isCents(convertedTotalCents)) err('no_converted');

  // rateio (calculado também com erros de total, para mostrar a prévia)
  let personShares = null;
  let consumers = null;
  let finalTotal = null;
  if (itemsOk && linesOk && discount <= subtotal) {
    const bySubtotal = order.map((id) => sum(itemShares.flatMap((s) => s.filter((p) => p.personId === id).map((p) => p.cents))));
    const t = allocate(taxAdded, bySubtotal);
    const g = allocate(tip, bySubtotal);
    const d = allocate(discount, bySubtotal);
    const shares = order.map((_, i) => bySubtotal[i] + t[i] + g[i] - d[i]);
    personShares = Object.fromEntries(order.map((id, i) => [id, shares[i]]));
    if (errors.length === 0) {
      let finalShares = shares;
      finalTotal = computedTotal;
      if (foreign) { finalShares = allocate(convertedTotalCents, shares); finalTotal = convertedTotalCents; }
      consumers = order.map((personId, i) => ({ personId, cents: finalShares[i] })).filter((c) => c.cents > 0);
    }
  }
  return { ok: errors.length === 0, errors, subtotal, taxAdded, taxIncluded, discount, tip, computedTotal, diff, personShares, consumers, finalTotal };
}

/** Gastos já lançados com a mesma data e o mesmo valor (possível duplicidade). */
export function findDuplicates(expenses, { date, cents, excludeId = null }) {
  return expenses.filter((x) => x.id !== excludeId && x.date === date && x.cents === cents);
}
