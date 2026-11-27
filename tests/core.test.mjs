import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, formatPlain, formatMoney } from '../docs/js/money.js';
import { isValidDate, todayLocal, diffDays, localTimestamp, formatDateBR } from '../docs/js/dates.js';
import { splitEqual, buildConsumers } from '../docs/js/split.js';
import { dashboard, floorDiv } from '../docs/js/calc.js';
import { validateTrip, validatePeopleNames } from '../docs/js/trip.js';

/* ---------- dinheiro ---------- */
test('parseMoney: formatos comuns', () => {
  assert.equal(parseMoney('12,50', 'USD'), 1250);
  assert.equal(parseMoney('12.5', 'USD'), 1250);
  assert.equal(parseMoney('1.234,56', 'USD'), 123456);
  assert.equal(parseMoney('1.234', 'USD'), 123400); // ponto + 3 dígitos = milhar
  assert.equal(parseMoney('3', 'USD'), 300);
  assert.equal(parseMoney('0,05', 'USD'), 5);
  assert.equal(parseMoney('R$ 7,00', 'BRL'), 700);
  assert.equal(parseMoney('  19,99 ', 'EUR'), 1999);
  assert.equal(parseMoney('0,1', 'USD'), 10);
});
test('parseMoney: inválidos', () => {
  for (const s of ['', 'abc', '-5', '1,234,5', '12,345', '1..2', '1,2,3', '12,5x', null, undefined, '99999999999999']) {
    assert.equal(parseMoney(s, 'USD'), null, `deveria rejeitar ${JSON.stringify(s)}`);
  }
});
test('parseMoney: moeda sem casas decimais (JPY)', () => {
  assert.equal(parseMoney('1500', 'JPY'), 1500);
  assert.equal(parseMoney('1.500', 'JPY'), 1500);
  assert.equal(parseMoney('15,5', 'JPY'), null);
});
test('formatPlain e ida/volta', () => {
  assert.equal(formatPlain(1250, 'USD'), '12,50');
  assert.equal(formatPlain(5, 'USD'), '0,05');
  assert.equal(formatPlain(-5, 'USD'), '-0,05');
  assert.equal(formatPlain(1500, 'JPY'), '1500');
  for (const c of [1, 99, 100, 101, 123456789]) assert.equal(parseMoney(formatPlain(c, 'USD'), 'USD'), c);
});
test('formatMoney usa pt-BR com a moeda da viagem', () => {
  const norm = (s) => s.replace(/\s/g, ' ');
  assert.equal(norm(formatMoney(123456, 'BRL')), 'R$ 1.234,56');
  assert.match(norm(formatMoney(1250, 'USD')), /12,50/);
  assert.match(norm(formatMoney(-1250, 'USD')), /-.*12,50/);
});
test('0,10 + 0,20 fecha exatamente em 0,30 (sem erro de ponto flutuante)', () => {
  assert.equal(parseMoney('0,10', 'USD') + parseMoney('0,20', 'USD'), parseMoney('0,30', 'USD'));
});

/* ---------- datas ---------- */
test('isValidDate', () => {
  assert.ok(isValidDate('2026-02-28'));
  assert.ok(isValidDate('2028-02-29'));
  for (const s of ['2026-02-29', '2026-13-01', '2026-00-10', '26-01-01', '2026-1-1', '', null, '2026-04-31']) assert.ok(!isValidDate(s), String(s));
});
test('todayLocal usa os componentes locais (não UTC)', () => {
  assert.equal(todayLocal(new Date(2026, 10, 27, 23, 59, 59)), '2026-11-27');
  assert.equal(todayLocal(new Date(2026, 0, 1, 0, 0, 1)), '2026-01-01');
  assert.equal(localTimestamp(new Date(2026, 5, 3, 7, 8, 9)), '2026-06-03T07:08:09');
});
test('diffDays: virada de mês/ano, bissexto e horário de verão', () => {
  assert.equal(diffDays('2026-12-31', '2026-12-30'), 1);
  assert.equal(diffDays('2027-01-01', '2026-12-31'), 1);
  assert.equal(diffDays('2028-03-01', '2028-02-28'), 2);
  assert.equal(diffDays('2026-03-09', '2026-03-08'), 1); // DST EUA
  assert.equal(diffDays('2026-11-02', '2026-11-01'), 1); // fim do DST
  assert.equal(diffDays('2026-10-10', '2026-10-10'), 0);
  assert.equal(diffDays('2026-10-01', '2026-10-10'), -9);
});
test('formatDateBR', () => assert.equal(formatDateBR('2026-07-04'), '04/07/2026'));

/* ---------- divisão ---------- */
const sumC = (p) => p.reduce((a, b) => a + b.cents, 0);
test('splitEqual: soma sempre bate, centavos para os primeiros', () => {
  assert.deepEqual(splitEqual(1000, ['a', 'b', 'c']), [{ personId: 'a', cents: 334 }, { personId: 'b', cents: 333 }, { personId: 'c', cents: 333 }]);
  assert.deepEqual(splitEqual(1, ['a', 'b', 'c']).map((x) => x.cents), [1, 0, 0]);
  assert.deepEqual(splitEqual(2, ['a', 'b', 'c']).map((x) => x.cents), [1, 1, 0]);
  assert.deepEqual(splitEqual(900, ['a']).map((x) => x.cents), [900]);
  for (let total = 1; total < 400; total++) for (const n of [1, 2, 3]) {
    const ids = ['a', 'b', 'c'].slice(0, n);
    assert.equal(sumC(splitEqual(total, ids)), total);
  }
});
test('buildConsumers: igual, valores e erros', () => {
  const base = { order: ['p1', 'p2', 'p3'], total: 1001 };
  const eq = buildConsumers({ ...base, mode: 'equal', selected: new Set(['p3', 'p1']) });
  assert.ok(eq.ok); assert.equal(sumC(eq.consumers), 1001);
  assert.deepEqual(eq.consumers.map((c) => c.personId), ['p1', 'p3']); // ordem canônica
  assert.equal(buildConsumers({ ...base, mode: 'equal', selected: new Set() }).code, 'no_consumer');
  assert.equal(buildConsumers({ ...base, total: 0, mode: 'equal', selected: new Set(['p1']) }).code, 'bad_total');

  const ok = buildConsumers({ ...base, mode: 'custom', selected: new Set(['p1', 'p2']), custom: { p1: 600, p2: 401 } });
  assert.ok(ok.ok); assert.equal(sumC(ok.consumers), 1001);
  const bad = buildConsumers({ ...base, mode: 'custom', selected: new Set(['p1', 'p2']), custom: { p1: 600, p2: 400 } });
  assert.deepEqual([bad.ok, bad.code, bad.diff], [false, 'sum_mismatch', 1]);
  const over = buildConsumers({ ...base, mode: 'custom', selected: new Set(['p1', 'p2']), custom: { p1: 700, p2: 400 } });
  assert.equal(over.diff, -99);
  assert.equal(buildConsumers({ ...base, mode: 'custom', selected: new Set(['p1', 'p2']), custom: { p1: 1001, p2: null } }).code, 'missing_value');
  assert.equal(buildConsumers({ ...base, mode: 'custom', selected: new Set(['p1']), custom: { p1: 0 } }).code, 'missing_value');
});

/* ---------- painel ---------- */
const people = [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }, { id: 'p3', name: 'C' }];
const trip = { name: 'T', start: '2026-10-01', end: '2026-10-10', currency: 'USD' };
const ent = (cents, date = '2026-09-20') => ({ id: `e${cents}${date}`, date, cents, description: '' });
const exp = (cents, date, parts) => ({
  id: `x${cents}${date}`, date, cents, store: '', category: 'outros', description: '', splitMode: 'equal',
  consumers: parts ?? splitEqual(cents, ['p1', 'p2', 'p3']),
});
const dash = (o) => dashboard({ trip, people, entries: [], expenses: [], ...o });

test('floorDiv', () => {
  assert.equal(floorDiv(7, 2), 3); assert.equal(floorDiv(-7, 2), -4); assert.equal(floorDiv(-6, 2), -3); assert.equal(floorDiv(0, 5), 0);
});
test('durante a viagem: limite = (saldo + gasto hoje) / dias restantes; resta = limite - hoje', () => {
  // 1000,00 de entrada; 100,00 gastos antes de hoje; 50,00 hoje (05/10). Saldo = 850,00; restam 6 dias (5..10).
  const D = dash({ today: '2026-10-05', entries: [ent(100000)], expenses: [exp(10000, '2026-10-03'), exp(5000, '2026-10-05')] });
  assert.equal(D.phase, 'during');
  assert.equal(D.balance, 85000);
  assert.equal(D.spentToday, 5000);
  assert.equal(D.daysRemaining, 6);
  assert.equal(D.dailyLimit, 15000); // (85000 + 5000) / 6
  assert.equal(D.remainingToday, 10000);
  assert.equal(D.dayIndex, 5);
  assert.deepEqual(D.alerts, []);
});
test('limite arredonda para baixo em centavos inteiros', () => {
  const D = dash({ today: '2026-10-08', entries: [ent(100000)] }); // 3 dias restantes
  assert.equal(D.dailyLimit, 33333);
});
test('primeiro e último dia', () => {
  const first = dash({ today: '2026-10-01', entries: [ent(100000)] });
  assert.equal(first.daysRemaining, 10); assert.equal(first.dailyLimit, 10000);
  const last = dash({ today: '2026-10-10', entries: [ent(100000)], expenses: [exp(2500, '2026-10-10')] });
  assert.equal(last.daysRemaining, 1);
  assert.equal(last.dailyLimit, 100000 - 2500 + 2500); // tudo que sobra + hoje
  assert.equal(last.remainingToday, 100000 - 2500);
});
test('antes da viagem: saldo / duração total; gasto antecipado reduz o saldo', () => {
  const D = dash({ today: '2026-09-25', entries: [ent(100000)], expenses: [exp(20000, '2026-09-20')] });
  assert.equal(D.phase, 'before');
  assert.equal(D.daysTotal, 10);
  assert.equal(D.balance, 80000);
  assert.equal(D.dailyLimit, 8000);
  assert.equal(D.remainingToday, null);
});
test('antes da viagem: gasto futuro já lançado também reduz o saldo, mas não conta como "hoje"', () => {
  const D = dash({ today: '2026-09-25', entries: [ent(100000)], expenses: [exp(10000, '2026-10-02')] });
  assert.equal(D.balance, 90000); assert.equal(D.spentToday, 0);
});
test('depois do fim: encerrada, sem limite', () => {
  const D = dash({ today: '2026-10-11', entries: [ent(100000)], expenses: [exp(30000, '2026-10-05')] });
  assert.equal(D.phase, 'after'); assert.equal(D.dailyLimit, null); assert.equal(D.remainingToday, null);
  assert.equal(D.balance, 70000); assert.equal(D.daysRemaining, 0);
});
test('saldo negativo gera alerta e limite negativo', () => {
  const D = dash({ today: '2026-10-05', entries: [ent(10000)], expenses: [exp(15000, '2026-10-04')] });
  assert.equal(D.balance, -5000);
  assert.ok(D.alerts.includes('negative_balance'));
  assert.ok(D.dailyLimit < 0);
});
test('estourar o limite de hoje com saldo positivo gera alerta próprio', () => {
  const D = dash({ today: '2026-10-05', entries: [ent(60000)], expenses: [exp(30000, '2026-10-05')] });
  // saldo 30000; (30000+30000)/6 = 10000; resta hoje = -20000
  assert.equal(D.remainingToday, -20000);
  assert.ok(D.alerts.includes('over_daily_limit') && !D.alerts.includes('negative_balance'));
});
test('sem entradas: alerta informativo', () => assert.ok(dash({ today: '2026-10-05' }).alerts.includes('no_entries')));
test('consumo por pessoa soma exatamente o total gasto', () => {
  const expenses = [exp(1001, '2026-10-02'), exp(999, '2026-10-03', [{ personId: 'p2', cents: 999 }]), exp(5, '2026-10-04', [{ personId: 'p1', cents: 2 }, { personId: 'p3', cents: 3 }])];
  const D = dash({ today: '2026-10-05', entries: [ent(100000)], expenses });
  assert.equal(D.perPerson.reduce((a, p) => a + p.cents, 0), D.totalSpent);
  assert.deepEqual(D.perPerson.map((p) => p.cents), [334 + 2, 334 + 999, 333 + 3]);
});
test('resultado independe do fuso horário do processo (usa só strings de data)', () => {
  const a = dash({ today: '2026-10-05', entries: [ent(100000)] });
  assert.equal(a.daysRemaining, 6);
});

/* ---------- viagem / pessoas ---------- */
test('validateTrip', () => {
  assert.deepEqual(validateTrip(trip), []);
  assert.ok(validateTrip({ ...trip, name: ' ' }).length);
  assert.ok(validateTrip({ ...trip, end: '2026-09-30' }).length);
  assert.deepEqual(validateTrip({ ...trip, end: trip.start }), []); // 1 dia é válido
  assert.ok(validateTrip({ ...trip, end: '2030-01-01' }).length);
  assert.ok(validateTrip({ ...trip, currency: 'XXX' }).length);
  assert.ok(validateTrip({ ...trip, start: '2026-02-30' }).length);
});
test('validatePeopleNames', () => {
  assert.deepEqual(validatePeopleNames(['A', 'B', 'C']), []);
  assert.ok(validatePeopleNames(['A', 'B', '']).length);
  assert.ok(validatePeopleNames(['A', 'a', 'C']).length);
  assert.ok(validatePeopleNames(['A', 'B']).length);
});
