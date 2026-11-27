// Cálculos do painel. Tudo em centavos inteiros; "hoje" é recebido como parâmetro (testável).
import { diffDays } from './dates.js';
import { sum } from './money.js';

/** Divisão inteira arredondando para baixo (também para negativos). b > 0. */
export function floorDiv(a, b) {
  const q = Math.trunc(a / b);
  return a - q * b < 0 ? q - 1 : q;
}

export function dashboard({ trip, people, entries, expenses, today }) {
  const totalIn = sum(entries.map((e) => e.cents));
  const totalSpent = sum(expenses.map((e) => e.cents));
  const balance = totalIn - totalSpent; // gastos antecipados também já reduzem o saldo
  const spentToday = sum(expenses.filter((e) => e.date === today).map((e) => e.cents));
  const daysTotal = diffDays(trip.end, trip.start) + 1;

  let phase;
  let daysRemaining;
  let dayIndex = null;
  let dailyLimit = null;
  let remainingToday = null;

  if (diffDays(today, trip.start) < 0) {
    phase = 'before';
    daysRemaining = daysTotal;
    dailyLimit = floorDiv(balance, daysTotal);
  } else if (diffDays(today, trip.end) > 0) {
    phase = 'after';
    daysRemaining = 0;
  } else {
    phase = 'during';
    dayIndex = diffDays(today, trip.start) + 1;
    daysRemaining = diffDays(trip.end, today) + 1; // inclui hoje
    dailyLimit = floorDiv(balance + spentToday, daysRemaining);
    remainingToday = dailyLimit - spentToday;
  }

  const perPerson = people.map((p) => ({ personId: p.id, name: p.name, cents: 0 }));
  for (const ex of expenses) {
    for (const part of ex.consumers) {
      const row = perPerson.find((r) => r.personId === part.personId);
      if (row) row.cents += part.cents;
    }
  }

  const alerts = [];
  if (balance < 0) alerts.push('negative_balance');
  else if (phase === 'during' && remainingToday < 0) alerts.push('over_daily_limit');
  if (entries.length === 0) alerts.push('no_entries');

  return {
    phase, balance, totalIn, totalSpent, spentToday, daysTotal, daysRemaining, dayIndex,
    dailyLimit, remainingToday, perPerson, alerts,
  };
}
