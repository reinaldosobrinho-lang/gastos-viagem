// Datas como texto "AAAA-MM-DD" no horário LOCAL. Nada de converter instantes para UTC.
// A contagem de dias usa Date.UTC apenas como aritmética de calendário (sem fuso/horário de verão).
const pad = (n) => String(n).padStart(2, '0');

export function isValidDate(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Data de hoje no relógio do aparelho. */
export function todayLocal(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** "AAAA-MM-DDTHH:mm:ss" no horário local, sem fuso. */
export function localTimestamp(now = new Date()) {
  return `${todayLocal(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

export function dayNumber(str) {
  const [y, m, d] = str.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

/** Dias entre a e b (a - b). */
export const diffDays = (a, b) => dayNumber(a) - dayNumber(b);

export function formatDateBR(str) {
  const [y, m, d] = str.split('-');
  return `${d}/${m}/${y}`;
}

export function formatDateLong(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', {
    weekday: 'short', day: '2-digit', month: 'short',
  });
}
