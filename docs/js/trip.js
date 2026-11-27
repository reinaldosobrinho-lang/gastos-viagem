// Validação dos dados da viagem (usada pelo formulário e pela restauração de backup).
import { CURRENCIES, MAX_TRIP_DAYS } from './constants.js';
import { isValidDate, diffDays } from './dates.js';

export function validateTrip(t) {
  const errors = [];
  if (!t || typeof t !== 'object') return ['Dados da viagem ausentes.'];
  if (typeof t.name !== 'string' || !t.name.trim()) errors.push('Informe o nome da viagem.');
  else if (t.name.trim().length > 80) errors.push('Nome da viagem muito longo (máx. 80).');
  const okStart = isValidDate(t.start);
  const okEnd = isValidDate(t.end);
  if (!okStart) errors.push('Data de início inválida.');
  if (!okEnd) errors.push('Data de fim inválida.');
  if (okStart && okEnd) {
    const days = diffDays(t.end, t.start) + 1;
    if (days < 1) errors.push('A data de fim não pode ser anterior à de início.');
    else if (days > MAX_TRIP_DAYS) errors.push(`A viagem não pode passar de ${MAX_TRIP_DAYS} dias.`);
  }
  if (!CURRENCIES.some((c) => c.code === t.currency)) errors.push('Moeda inválida.');
  return errors;
}

export function validatePeopleNames(names) {
  const errors = [];
  if (!Array.isArray(names) || names.length !== 3) return ['São necessárias exatamente 3 pessoas.'];
  const clean = names.map((n) => (typeof n === 'string' ? n.trim() : ''));
  if (clean.some((n) => !n)) errors.push('Informe o nome das 3 pessoas.');
  else if (clean.some((n) => n.length > 30)) errors.push('Nome de pessoa muito longo (máx. 30).');
  else if (new Set(clean.map((n) => n.toLowerCase())).size !== 3) errors.push('Os 3 nomes devem ser diferentes.');
  return errors;
}
