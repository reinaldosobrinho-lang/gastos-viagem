// Dados da linha do tempo (puro, testável): por dia, saldo real, saldo projetado nos dois cenários,
// planejado (mín/máx das atividades) × gasto real, e os ícones das atividades.
import { sum } from './money.js';
import { DEFAULT_ICON } from './icons.js';

const WEEKDAY = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

export function timelineData({ entries, expenses, activities, forecast, today }) {
  const byId = new Map(activities.map((a) => [a.id, a]));
  const days = forecast.days.map((d) => {
    const acts = d.activities.map((id) => byId.get(id)).filter(Boolean);
    const live = acts.filter((a) => a.status !== 'cancelled');
    const priced = live.filter((a) => a.min !== null && a.min !== undefined);
    const [y, m, dd] = d.date.split('-').map(Number);
    const reached = d.date <= today; // datas ISO: comparação de texto é cronológica
    const balReal = reached
      ? sum(entries.filter((e) => e.date <= d.date).map((e) => e.cents)) - sum(expenses.filter((x) => x.date <= d.date).map((x) => x.cents))
      : null;
    return {
      date: d.date, dayNum: dd, month: m, weekday: WEEKDAY[new Date(y, m - 1, dd).getDay()],
      balReal, projMin: d.projMin, projMax: d.projMax, realSpent: d.realSpent,
      planMin: sum(priced.map((a) => a.min)), planMax: sum(priced.map((a) => a.max)),
      icons: live.map((a) => a.icon || DEFAULT_ICON),
      activityIds: d.activities,
      unpriced: live.filter((a) => a.status === 'planned' && (a.min === null || a.min === undefined)).length,
      isToday: d.date === today, future: d.future, outOfRange: d.outOfRange,
    };
  });
  return { days, todayIndex: days.findIndex((d) => d.isToday) };
}
