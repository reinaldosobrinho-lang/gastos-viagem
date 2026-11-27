// Calculadora de gorjeta (pura, testável). Tudo em centavos inteiros, arredondando para o centavo mais próximo
// (meio centavo sobe). Não existe percentual obrigatório: os três padrões abaixo são sugestões editáveis.
export const DEFAULT_TIP_PCTS = [18, 20, 25];

/** Aceita exatamente 3 percentuais inteiros de 0 a 100; senão retorna null. */
export function normalizePcts(v) {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const n = v.map((x) => (typeof x === 'string' && x.trim() === '' ? NaN : Number(x)));
  return n.every((x) => Number.isInteger(x) && x >= 0 && x <= 100) ? n : null;
}

export const roundDivHalfUp = (n, d) => Math.floor((2 * n + d) / (2 * d));

/**
 * billCents: total da conta que entregaram (com imposto). taxCents: imposto dessa conta (opcional).
 * preTax: calcula sobre (conta - imposto) quando há imposto informado; senão sobre a conta toda.
 * Retorna { ok, base, options:[{pct, tipCents, totalCents}] } ou { ok:false, code }.
 * Códigos: no_bill, bad_tax, tax_too_high.
 */
export function tipOptions({ billCents, taxCents = 0, preTax = true, pcts = DEFAULT_TIP_PCTS }) {
  if (!Number.isSafeInteger(billCents) || billCents <= 0) return { ok: false, code: 'no_bill' };
  if (!Number.isSafeInteger(taxCents) || taxCents < 0) return { ok: false, code: 'bad_tax' };
  if (taxCents >= billCents) return { ok: false, code: 'tax_too_high' };
  const base = preTax ? billCents - taxCents : billCents;
  const options = pcts.map((pct) => {
    const tipCents = roundDivHalfUp(base * pct, 100);
    return { pct, tipCents, totalCents: billCents + tipCents };
  });
  return { ok: true, base, options };
}
