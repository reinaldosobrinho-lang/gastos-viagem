import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShares, splitEqual } from '../docs/js/split.js';
import { computeForecast } from '../docs/js/forecast.js';
import { addDays } from '../docs/js/dates.js';

const people = [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }, { id: 'p3', name: 'C' }];
const trip = { name: 'T', start: '2026-10-01', end: '2026-10-05', currency: 'USD' };
const IDS = ['p1', 'p2', 'p3'];

/* ---------- datas ---------- */
test('addDays: virada de mês, ano, bissexto e horário de verão', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

/* ---------- divisão da previsão ---------- */
const sh = (r) => r.shares.map((s) => [s.personId, s.min, s.max]);
test('buildShares igual: mín e máx fecham no centavo; mín <= máx por pessoa', () => {
  const r = buildShares({ mode: 'equal', min: 10000, max: 30001, order: IDS, selected: new Set(IDS) });
  assert.ok(r.ok);
  assert.equal(r.shares.reduce((a, s) => a + s.min, 0), 10000);
  assert.equal(r.shares.reduce((a, s) => a + s.max, 0), 30001);
  assert.deepEqual(sh(r), [['p1', 3334, 10001], ['p2', 3333, 10000], ['p3', 3333, 10000]]);
  for (let min = 0; min < 60; min++) for (let max = min; max < min + 8; max++) {
    for (const n of [1, 2, 3]) {
      const ids = IDS.slice(0, n);
      const x = buildShares({ mode: 'equal', min, max, order: IDS, selected: new Set(ids) });
      assert.ok(x.ok);
      assert.equal(x.shares.reduce((a, s) => a + s.min, 0), min);
      assert.equal(x.shares.reduce((a, s) => a + s.max, 0), max);
      assert.ok(x.shares.every((s) => s.min <= s.max));
    }
  }
});
test('buildShares: validações', () => {
  const base = { order: IDS, selected: new Set(['p1', 'p2']), mode: 'equal' };
  assert.equal(buildShares({ ...base, min: 500, max: 400 }).code, 'min_gt_max');
  assert.equal(buildShares({ ...base, selected: new Set(), min: 1, max: 2 }).code, 'no_participant');
  assert.equal(buildShares({ ...base, min: -1, max: 2 }).code, 'bad_values');
  assert.equal(buildShares({ ...base, min: 1.5, max: 2 }).code, 'bad_values');
  assert.ok(buildShares({ ...base, min: 0, max: 0 }).ok); // atividade gratuita é válida
  assert.equal(buildShares({ ...base, mode: 'xx', min: 1, max: 2 }).code, 'bad_mode');
});
test('buildShares personalizada: soma de mín e de máx precisa fechar', () => {
  const base = { mode: 'custom', min: 1000, max: 3000, order: IDS, selected: new Set(['p1', 'p2']) };
  const ok = buildShares({ ...base, custom: { p1: { min: 600, max: 2000 }, p2: { min: 400, max: 1000 } } });
  assert.ok(ok.ok);
  assert.equal(buildShares({ ...base, custom: { p1: { min: 600, max: 2000 }, p2: { min: 300, max: 1000 } } }).code, 'sum_min_mismatch');
  const mx = buildShares({ ...base, custom: { p1: { min: 600, max: 2000 }, p2: { min: 400, max: 1100 } } });
  assert.deepEqual([mx.code, mx.diff], ['sum_max_mismatch', -100]);
  assert.equal(buildShares({ ...base, custom: { p1: { min: 600, max: 500 }, p2: { min: 400, max: 2500 } } }).code, 'person_min_gt_max');
  assert.equal(buildShares({ ...base, custom: { p1: { min: 1000, max: 3000 }, p2: null } }).code, 'missing_value');
  assert.equal(buildShares({ ...base, custom: { p1: { min: null, max: 3000 }, p2: { min: 0, max: 0 } } }).code, 'missing_value');
});

/* ---------- previsão ---------- */
const act = (o) => {
  const ids = o.ids ?? IDS;
  const r = buildShares({ mode: 'equal', min: o.min, max: o.max, order: IDS, selected: new Set(ids) });
  return { id: o.id ?? 'a1', date: o.date ?? '2026-10-03', title: o.title ?? 'Parque', status: o.status ?? 'planned', min: o.min, max: o.max,
    splitMode: 'equal', createdAt: '', participants: ids, shares: o.shares ?? r.shares };
};
const exp = (cents, date, over = {}) => ({
  id: `x${cents}${date}${over.activityId ?? ''}`, date, cents, store: '', category: 'outros', description: '', splitMode: 'equal',
  consumers: over.consumers ?? splitEqual(cents, IDS), activityId: null, ...over,
});
const F = (o) => computeForecast({ trip, people, activities: [], expenses: [], today: '2026-10-02', balance: 0, ...o });

test('restante = max(previsão - já gasto, 0), mín e máx', () => {
  const a = act({ min: 10000, max: 30000 });
  const r1 = F({ activities: [a], balance: 100000 }).perActivity.a1;
  assert.deepEqual([r1.remMin, r1.remMax, r1.spent], [10000, 30000, 0]);
  const r2 = F({ activities: [a], expenses: [exp(4000, '2026-10-03', { activityId: 'a1' })] }).perActivity.a1;
  assert.deepEqual([r2.remMin, r2.remMax], [6000, 26000]);
  const r3 = F({ activities: [a], expenses: [exp(15000, '2026-10-03', { activityId: 'a1' })] }).perActivity.a1;
  assert.deepEqual([r3.remMin, r3.remMax, r3.overspent], [0, 15000, false]);
  const r4 = F({ activities: [a], expenses: [exp(35000, '2026-10-03', { activityId: 'a1' })] }).perActivity.a1;
  assert.deepEqual([r4.remMin, r4.remMax, r4.overspent], [0, 0, true]); // nunca negativo
});
test('concluída ou cancelada: sem previsão restante', () => {
  for (const status of ['done', 'cancelled']) {
    const f = F({ activities: [act({ min: 10000, max: 30000, status })], balance: 50000 });
    assert.deepEqual([f.trip.remMin, f.trip.remMax, f.trip.projMin, f.trip.projMax], [0, 0, 50000, 50000]);
    assert.deepEqual(f.alerts, []);
  }
});
test('gasto vinculado não é contado duas vezes (real + restante)', () => {
  // saldo: 1000,00 - 40,00 gastos = 960,00; atividade 100-300 com 40,00 já gastos nela
  const f = F({ activities: [act({ min: 10000, max: 30000 })], expenses: [exp(4000, '2026-10-03', { activityId: 'a1' })], balance: 96000 });
  assert.equal(f.trip.real, 4000);
  assert.equal(f.trip.remMin, 6000); assert.equal(f.trip.remMax, 26000);
  assert.equal(f.trip.estMin, 10000); assert.equal(f.trip.estMax, 30000); // = previsão da atividade, não 14000/34000
  assert.equal(f.trip.projMin, 90000); assert.equal(f.trip.projMax, 70000);
});
test('gasto sem vínculo não mexe na previsão da atividade', () => {
  const f = F({ activities: [act({ min: 10000, max: 30000 })], expenses: [exp(4000, '2026-10-03')], balance: 96000 });
  assert.equal(f.trip.remMin, 10000);
});
test('por pessoa: mesma conta com a parte e o consumo de cada um', () => {
  const a = act({ min: 30000, max: 60000 }); // 100,00 a 200,00 por pessoa
  // A consumiu 120,00 sozinho na atividade; B e C não gastaram nada
  const f = F({ activities: [a], expenses: [exp(12000, '2026-10-03', { activityId: 'a1', consumers: [{ personId: 'p1', cents: 12000 }] })], balance: 100000 });
  const byId = Object.fromEntries(f.persons.map((p) => [p.personId, p]));
  assert.deepEqual([byId.p1.consumed, byId.p1.remMin, byId.p1.remMax, byId.p1.estMin, byId.p1.estMax], [12000, 0, 8000, 12000, 20000]);
  assert.deepEqual([byId.p2.consumed, byId.p2.remMin, byId.p2.remMax, byId.p2.estMin, byId.p2.estMax], [0, 10000, 20000, 10000, 20000]);
  assert.deepEqual([byId.p3.remMin, byId.p3.remMax], [10000, 20000]);
  // restante da atividade: max(300 - 120, 0)=180 / max(600-120,0)=480; por pessoa soma 200/480+... diferença esperada e documentada
  assert.deepEqual([f.trip.remMin, f.trip.remMax], [18000, 48000]);
});
test('por pessoa: quem não participa não tem previsão', () => {
  const a = act({ min: 10000, max: 20000, ids: ['p1', 'p2'] });
  const f = F({ activities: [a], balance: 100000 });
  const p3 = f.persons.find((p) => p.personId === 'p3');
  assert.deepEqual([p3.remMin, p3.remMax], [0, 0]);
});
test('saldo projetado nos dois cenários e alertas', () => {
  const a = act({ min: 40000, max: 90000 });
  assert.deepEqual(F({ activities: [a], balance: 100000 }).alerts, []);
  const f1 = F({ activities: [a], balance: 60000 }); // cobre o mínimo (400), não o máximo (900)
  assert.deepEqual([f1.trip.projMin, f1.trip.projMax], [20000, -30000]);
  assert.deepEqual(f1.alerts, ['max_not_covered']);
  const f2 = F({ activities: [a], balance: 30000 });
  assert.deepEqual(f2.alerts, ['min_not_covered', 'max_not_covered']);
  const f3 = F({ activities: [a], balance: 40000 }); // exatamente o mínimo: cobre
  assert.deepEqual(f3.alerts, ['max_not_covered']);
});
test('por dia: acumulado a partir de hoje; dias passados não têm projeção', () => {
  const acts = [
    act({ id: 'a1', date: '2026-10-02', min: 10000, max: 20000 }), // hoje
    act({ id: 'a2', date: '2026-10-04', min: 5000, max: 15000 }),
  ];
  const f = F({ activities: acts, balance: 50000, expenses: [exp(7000, '2026-10-01')] });
  const d = Object.fromEntries(f.days.map((x) => [x.date, x]));
  assert.equal(f.days.length, 5);
  assert.equal(d['2026-10-01'].projMin, null);
  assert.equal(d['2026-10-01'].realSpent, 7000);
  assert.deepEqual([d['2026-10-02'].projMin, d['2026-10-02'].projMax], [40000, 30000]);
  assert.deepEqual([d['2026-10-03'].projMin, d['2026-10-03'].projMax], [40000, 30000]);
  assert.deepEqual([d['2026-10-04'].projMin, d['2026-10-04'].projMax], [35000, 15000]);
  assert.deepEqual([d['2026-10-05'].projMin, d['2026-10-05'].projMax], [35000, 15000]);
  assert.equal(d['2026-10-05'].projMin, f.trip.projMin); // último dia = viagem toda
  assert.equal(d['2026-10-05'].projMax, f.trip.projMax);
});
test('atividade atrasada e pendente: avisa e já entra na projeção', () => {
  const late = act({ id: 'late', date: '2026-10-01', min: 10000, max: 20000 });
  const f = F({ activities: [late], balance: 50000 });
  assert.deepEqual(f.overdue, ['late']);
  assert.deepEqual([f.trip.projMin, f.trip.projMax], [40000, 30000]);
  const d2 = f.days.find((d) => d.date === '2026-10-02');
  assert.deepEqual([d2.projMin, d2.projMax], [40000, 30000]); // atrasada contada antes do 1º dia futuro
  const done = F({ activities: [{ ...late, status: 'done' }], balance: 50000 });
  assert.deepEqual(done.overdue, []);
  const today = F({ activities: [{ ...late, date: '2026-10-02' }], balance: 50000 });
  assert.deepEqual(today.overdue, []); // hoje ainda não é "passada"
});
test('dias sem previsão: só de hoje em diante e dentro do período; cancelada não conta', () => {
  const f = F({ activities: [act({ id: 'a1', date: '2026-10-03', min: 1, max: 2 }), act({ id: 'a2', date: '2026-10-04', min: 1, max: 2, status: 'cancelled' })] });
  assert.deepEqual(f.noForecastDays, ['2026-10-02', '2026-10-04', '2026-10-05']);
  const done = F({ activities: [act({ id: 'a1', date: '2026-10-02', min: 1, max: 2, status: 'done' })] });
  assert.ok(!done.noForecastDays.includes('2026-10-02')); // dia com atividade concluída não é "vazio"
});
test('atividade fora do período aparece como dia extra', () => {
  const f = F({ activities: [act({ date: '2026-10-09', min: 100, max: 200 })], balance: 1000 });
  const d = f.days.find((x) => x.date === '2026-10-09');
  assert.ok(d.outOfRange); assert.equal(f.days.at(-1).date, '2026-10-09');
  assert.equal(f.days.at(-1).projMin, 900);
});
test('antes da viagem: tudo é futuro; depois do fim: sem dias futuros', () => {
  const before = F({ activities: [act({ min: 100, max: 200 })], today: '2026-09-20', balance: 1000 });
  assert.ok(before.days.every((d) => d.future));
  const after = F({ activities: [act({ min: 100, max: 200 })], today: '2026-10-20', balance: 1000 });
  assert.ok(after.days.every((d) => !d.future && d.projMin === null));
  assert.deepEqual(after.overdue, ['a1']);
  assert.equal(after.trip.projMin, 900);
});
test('sem atividades: previsão zerada e sem alertas', () => {
  const f = F({ balance: 12345 });
  assert.deepEqual([f.trip.remMin, f.trip.remMax, f.trip.projMin, f.trip.projMax], [0, 0, 12345, 12345]);
  assert.deepEqual(f.alerts, []);
});
