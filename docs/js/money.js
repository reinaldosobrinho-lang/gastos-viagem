// Dinheiro sempre em inteiros da menor unidade (centavos). Nunca float em cálculos.
const ZERO_DECIMALS = new Set(['JPY', 'KRW', 'CLP', 'VND', 'PYG', 'ISK', 'UGX']);
const MAX_MINOR = 1e13;

export const minorDigits = (currency) => (ZERO_DECIMALS.has(currency) ? 0 : 2);

/**
 * Converte texto digitado ("12,50", "1.234,56", "12.5", "R$ 3") em centavos inteiros.
 * Retorna null se inválido. Aceita zero (quem chama decide se zero vale).
 */
export function parseMoney(input, currency = 'USD') {
  if (typeof input !== 'string') return null;
  const d = minorDigits(currency);
  let s = input.replace(/[\s ]/g, '').replace(/^[^\d,.-]+/, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;

  let whole;
  let frac = '';
  const commas = (s.match(/,/g) || []).length;
  if (commas > 1) return null;

  if (commas === 1) {
    const [a, b] = s.split(',');
    if (!/^(\d+|\d{1,3}(\.\d{3})+)$/.test(a)) return null;
    whole = a.replace(/\./g, '');
    frac = b;
  } else {
    const dots = (s.match(/\./g) || []).length;
    if (dots === 0) {
      whole = s;
    } else {
      const parts = s.split('.');
      const last = parts[parts.length - 1];
      if (dots === 1 && last.length !== 3) {
        whole = parts[0];
        frac = last; // ponto como separador decimal (12.5)
      } else {
        if (!/^\d{1,3}(\.\d{3})+$/.test(s)) return null; // ponto como milhar
        whole = s.replace(/\./g, '');
      }
    }
  }
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(frac) || frac.length > d) return null;
  if (whole.length > 12) return null;

  const fracPart = d === 0 ? 0 : Number((frac + '0'.repeat(d)).slice(0, d));
  const value = Number(whole) * 10 ** d + fracPart;
  return Number.isSafeInteger(value) && value < MAX_MINOR ? value : null;
}

/** "1.234,56" sem símbolo, para preencher campos de edição. */
export function formatPlain(cents, currency = 'USD') {
  const d = minorDigits(currency);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  if (d === 0) return sign + String(abs);
  const whole = Math.floor(abs / 10 ** d);
  const frac = String(abs - whole * 10 ** d).padStart(d, '0');
  return `${sign}${whole},${frac}`;
}

/** Formatação para exibição (ex.: "US$ 12,50"). Só para mostrar; não use para calcular. */
export function formatMoney(cents, currency = 'USD') {
  const d = minorDigits(currency);
  const value = cents === 0 ? 0 : cents / 10 ** d;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value);
}

export const sum = (arr) => arr.reduce((a, b) => a + b, 0);
