// Cronograma e previsão. Tudo em centavos inteiros; "hoje" e "saldo" são parâmetros (testável).
//
// Regras:
// - O gasto real vive SÓ nos gastos lançados. A atividade guarda apenas a previsão (mín/máx).
// - Gasto vinculado a uma atividade reduz o que ainda resta dela (não é contado duas vezes):
//     restante = max(previsão - já gasto vinculado, 0)   (só para atividade "planejada")
// - Atividade concluída ou cancelada: nenhuma previsão restante.
// - Atividade sem valor previsto (min/max nulos): não entra na previsão; é listada em `unpriced`.
// - Por pessoa, a mesma conta, usando a parte de cada participante e o que ELA consumiu
//   nos gastos vinculados. Por isso a soma por pessoa pode diferir do restante da atividade
//   quando o gasto real foi dividido de forma diferente da previsão.
// - Saldo projetado (cenário mín/máx) = saldo atual - previsão restante (mín/máx).
//   Por dia: acumulado a partir de hoje (atividades atrasadas e pendentes entram antes do primeiro dia).
import { addDays, diffDays } from './dates.js';
import { sum } from './money.js';

export function computeForecast({ trip, people, activities, expenses, today, balance }) {
  // --- por atividade ---
  const per = {};
  for (const a of activities) {
    const linked = expenses.filter((x) => x.activityId === a.id);
    const spent = sum(linked.map((x) => x.cents));
    const spentBy = {};
    for (const x of linked) for (const c of x.consumers) spentBy[c.personId] = (spentBy[c.personId] ?? 0) + c.cents;
    const priced = a.min !== null && a.min !== undefined; // sem valor previsto: fora da previsão
    const pending = a.status === 'planned' && priced;
    const remBy = {};
    if (pending) {
      for (const s of a.shares) {
        const got = spentBy[s.personId] ?? 0;
        remBy[s.personId] = { min: Math.max(s.min - got, 0), max: Math.max(s.max - got, 0) };
      }
    }
    per[a.id] = {
      id: a.id, spent, spentBy, remBy,
      remMin: pending ? Math.max(a.min - spent, 0) : 0,
      remMax: pending ? Math.max(a.max - spent, 0) : 0,
      overspent: pending && spent > a.max,
      overdue: pending && diffDays(today, a.date) > 0,
    };
  }

  // --- dias: período da viagem + datas de atividades fora dele ---
  const tripDays = new Set();
  for (let d = trip.start; diffDays(trip.end, d) >= 0; d = addDays(d, 1)) tripDays.add(d);
  const dateSet = new Set(tripDays);
  for (const a of activities) dateSet.add(a.date);
  const dates = [...dateSet].sort();

  const spentByDate = {};
  for (const x of expenses) spentByDate[x.date] = (spentByDate[x.date] ?? 0) + x.cents;

  const overdue = activities.filter((a) => per[a.id].overdue);
  let runMin = balance - sum(overdue.map((a) => per[a.id].remMin));
  let runMax = balance - sum(overdue.map((a) => per[a.id].remMax));

  const days = dates.map((date) => {
    const acts = activities.filter((a) => a.date === date)
      .sort((p, q) => (p.createdAt || '').localeCompare(q.createdAt || '') || p.title.localeCompare(q.title));
    const remMin = sum(acts.map((a) => per[a.id].remMin));
    const remMax = sum(acts.map((a) => per[a.id].remMax));
    const future = diffDays(date, today) >= 0; // hoje conta como "ainda por vir"
    let projMin = null;
    let projMax = null;
    if (future) {
      runMin -= remMin; runMax -= remMax;
      projMin = runMin; projMax = runMax;
    }
    return {
      date, activities: acts.map((a) => a.id), realSpent: spentByDate[date] ?? 0, remMin, remMax, future,
      projMin, projMax, outOfRange: !tripDays.has(date),
      noForecast: future && tripDays.has(date) && !acts.some((a) => a.status !== 'cancelled'),
    };
  });

  // --- viagem toda ---
  const real = sum(expenses.map((x) => x.cents));
  const remMin = sum(activities.map((a) => per[a.id].remMin));
  const remMax = sum(activities.map((a) => per[a.id].remMax));
  const trp = {
    balance, real, remMin, remMax,
    projMin: balance - remMin, projMax: balance - remMax,
    estMin: real + remMin, estMax: real + remMax,
  };

  // --- por pessoa ---
  const persons = people.map((p) => {
    let consumed = 0;
    for (const x of expenses) for (const c of x.consumers) if (c.personId === p.id) consumed += c.cents;
    let pMin = 0;
    let pMax = 0;
    for (const a of activities) {
      const r = per[a.id].remBy[p.id];
      if (r) { pMin += r.min; pMax += r.max; }
    }
    return { personId: p.id, name: p.name, consumed, remMin: pMin, remMax: pMax, estMin: consumed + pMin, estMax: consumed + pMax };
  });

  // --- alertas ---
  const alerts = [];
  if (remMin > 0 && trp.projMin < 0) alerts.push('min_not_covered');
  if (remMax > 0 && trp.projMax < 0) alerts.push('max_not_covered');

  return {
    perActivity: per, days, trip: trp, persons, alerts,
    overdue: overdue.map((a) => a.id),
    unpriced: activities.filter((a) => a.status === 'planned' && (a.min === null || a.min === undefined)).map((a) => a.id),
    overspent: activities.filter((a) => per[a.id].overspent).map((a) => a.id),
    noForecastDays: days.filter((d) => d.noForecast).map((d) => d.date),
  };
}
