import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestIcon, ICON_CHOICES, DEFAULT_ICON } from '../docs/js/icons.js';
import { buildShares } from '../docs/js/split.js';
import { computeForecast } from '../docs/js/forecast.js';
import { timelineData } from '../docs/js/timeline.js';
import { buildTimelineSvg, COL } from '../docs/js/chart.js';
import { parseScheduleImport } from '../docs/js/schedule-import.js';

const IDS = ['p1', 'p2', 'p3'];
const people = IDS.map((id, i) => ({ id, name: ['A', 'B', 'C'][i] }));
const trip = { name: 'T', start: '2026-10-01', end: '2026-10-05', currency: 'USD' };

test('suggestIcon: palavras-chave, acentos e padrão', () => {
  const cases = { 'MAGIC KINGDOM': '🏰', 'EPCOT — até 21h': '🌐', 'Animal Kingdom': '🦁', 'Hollywood Studios': '🎬', 'Sea World': '🐬', NASA: '🚀',
    'Clearwater Beach': '🏖️', 'jogo da nba': '🏀', 'jogo do tampa': '🏟️', 'epic': '🎢', 'Island / ou Universal': '🎢', 'Natal - descanso': '🎄',
    descanso: '🛋️', RETORNO: '✈️', 'Café da manhã': '☕', 'Almoço': '🍽️', 'Outlet The Loop': '🛍️', Walmart: '🛒', 'algo qualquer': DEFAULT_ICON, '': DEFAULT_ICON };
  for (const [t, icon] of Object.entries(cases)) assert.equal(suggestIcon(t), icon, t);
  assert.ok(ICON_CHOICES.includes('🏰') && ICON_CHOICES.includes(DEFAULT_ICON));
  assert.ok(ICON_CHOICES.every((e) => e.length <= 16));
});

test('buildShares: sem valor (null/null) é aceito; um só nulo não', () => {
  const base = { mode: 'equal', order: IDS, selected: new Set(IDS) };
  assert.deepEqual(buildShares({ ...base, min: null, max: null }), { ok: true, shares: [] });
  assert.equal(buildShares({ ...base, min: null, max: 5 }).code, 'bad_values');
  assert.equal(buildShares({ ...base, selected: new Set(), min: null, max: null }).code, 'no_participant');
});

const act = (o) => ({ id: o.id, date: o.date, title: 'x', status: o.status ?? 'planned', min: o.min ?? null, max: o.max ?? null, icon: o.icon ?? '', notes: '',
  splitMode: 'equal', createdAt: '', participants: IDS, shares: o.min == null ? [] : buildShares({ mode: 'equal', min: o.min, max: o.max, order: IDS, selected: new Set(IDS) }).shares });

test('previsão: atividade sem valor não entra nas contas, mas é listada', () => {
  const acts = [act({ id: 'a', date: '2026-10-03' }), act({ id: 'b', date: '2026-10-03', min: 1000, max: 2000 })];
  const F = computeForecast({ trip, people, activities: acts, expenses: [], today: '2026-10-02', balance: 10000 });
  assert.deepEqual([F.trip.remMin, F.trip.remMax], [1000, 2000]);
  assert.deepEqual(F.unpriced, ['a']);
  assert.ok(!F.noForecastDays.includes('2026-10-03')); // o dia tem atividade planejada (mesmo sem valor)
});

test('linha do tempo: saldo real acumulado, projeção, planejado × real e ícones', () => {
  const entries = [{ id: 'e', date: '2026-09-30', cents: 100000 }];
  const expenses = [{ id: 'x', date: '2026-10-01', cents: 7000, consumers: [{ personId: 'p1', cents: 7000 }], activityId: null },
    { id: 'y', date: '2026-10-02', cents: 3000, consumers: [{ personId: 'p1', cents: 3000 }], activityId: null }];
  const activities = [act({ id: 'a', date: '2026-10-02', min: 4000, max: 6000, icon: '🎢' }), act({ id: 'b', date: '2026-10-04', min: 1000, max: 2000, icon: '🏰' }),
    act({ id: 'c', date: '2026-10-04', status: 'cancelled', min: 9000, max: 9000, icon: '🚀' }), act({ id: 'd', date: '2026-10-04', icon: '🛋️' })];
  const balance = 100000 - 10000;
  const F = computeForecast({ trip, people, activities, expenses, today: '2026-10-02', balance });
  const T = timelineData({ entries, expenses, activities, forecast: F, today: '2026-10-02' });
  const d = Object.fromEntries(T.days.map((x) => [x.date, x]));
  assert.equal(T.todayIndex, 1);
  assert.deepEqual([d['2026-10-01'].balReal, d['2026-10-02'].balReal, d['2026-10-03'].balReal], [93000, 90000, null]);
  assert.equal(d['2026-10-01'].projMin, null);
  assert.deepEqual([d['2026-10-02'].planMin, d['2026-10-02'].planMax, d['2026-10-02'].realSpent], [4000, 6000, 3000]);
  assert.deepEqual([d['2026-10-04'].planMin, d['2026-10-04'].planMax], [1000, 2000]); // cancelada e sem valor não somam
  assert.deepEqual(d['2026-10-04'].icons, ['🏰', '🛋️']); // cancelada não aparece
  assert.equal(d['2026-10-04'].unpriced, 1);
  assert.equal(d['2026-10-02'].isToday, true);
  assert.deepEqual([d['2026-10-05'].projMin, d['2026-10-05'].projMax], [F.trip.projMin, F.trip.projMax]);
  assert.equal(d['2026-10-01'].weekday, 'Q'); // 01/10/2026 é quinta
});

test('gráfico: gera SVG com um bloco por dia, sem NaN, também sem dados', () => {
  const label = (v) => String(v);
  const F = computeForecast({ trip, people, activities: [], expenses: [], today: '2026-10-02', balance: 0 });
  const T = timelineData({ entries: [], expenses: [], activities: [], forecast: F, today: '2026-10-02' });
  const { plot, axis, width } = buildTimelineSvg(T, { label });
  assert.equal(width, 5 * COL);
  assert.equal((plot.match(/class="tl-hit"/g) || []).length, 5);
  assert.ok(!/NaN|undefined|Infinity/.test(plot + axis));
  // com saldo negativo, projeção e depois do fim
  const acts = [act({ id: 'a', date: '2026-10-04', min: 5000, max: 90000, icon: '🎢' })];
  for (const today of ['2026-09-20', '2026-10-03', '2026-10-20']) {
    const F2 = computeForecast({ trip, people, activities: acts, expenses: [], today, balance: 30000 });
    const T2 = timelineData({ entries: [{ id: 'e', date: '2026-09-01', cents: 30000 }], expenses: [], activities: acts, forecast: F2, today });
    const s = buildTimelineSvg(T2, { label });
    assert.ok(!/NaN|undefined|Infinity/.test(s.plot + s.axis), today);
    if (today !== '2026-10-20') assert.ok(s.plot.includes('tl-neg'), `zona negativa em ${today}`); // cenário máximo fica negativo; depois do fim não há projeção
  }
});

/* ---------- importação ---------- */
let n = 0;
const uid = () => `id${++n}`;
const file = (activities) => ({ app: 'gastos-viagem', kind: 'cronograma', schema: 1, activities });
const NOW = new Date(2026, 10, 27, 10, 0, 0);

test('importação: padrões (3 pessoas, planejada, sem valor, ícone sugerido) e ordem preservada', () => {
  const r = parseScheduleImport(file([{ date: '2026-12-05', title: 'MAGIC KINGDOM' }, { date: '2026-12-05', title: 'Jantar' }, { date: '2026-12-06', title: 'Zebra', icon: '🦁', notes: 'obs' }]), { people, uid, now: NOW });
  assert.ok(r.ok, r.errors?.join('|'));
  assert.deepEqual(r.activities.map((a) => [a.title, a.icon, a.status, a.min, a.participants.length, a.shares.length]),
    [['MAGIC KINGDOM', '🏰', 'planned', null, 3, 0], ['Jantar', '🍽️', 'planned', null, 3, 0], ['Zebra', '🦁', 'planned', null, 3, 0]]);
  assert.ok(r.activities[0].createdAt < r.activities[1].createdAt); // mantém a ordem do arquivo
  assert.deepEqual([r.summary.count, r.summary.first, r.summary.last, r.summary.unpriced], [3, '2026-12-05', '2026-12-06', 3]);
});
test('importação: com valores divide igualmente; participantes informados', () => {
  const r = parseScheduleImport(file([{ date: '2026-12-05', title: 'Parque', min: 10000, max: 30001, participants: ['p1', 'p3'] }]), { people, uid, now: NOW });
  assert.ok(r.ok);
  assert.deepEqual(r.activities[0].shares, [{ personId: 'p1', min: 5000, max: 15001 }, { personId: 'p3', min: 5000, max: 15000 }]);
});
test('importação: ignora duplicatas (data + título), no arquivo e já existentes', () => {
  const existing = [{ date: '2026-12-05', title: 'parque ' }];
  const r = parseScheduleImport(file([{ date: '2026-12-05', title: 'Parque' }, { date: '2026-12-06', title: 'Praia' }, { date: '2026-12-06', title: 'PRAIA' }]), { people, existing, uid, now: NOW });
  assert.ok(r.ok); assert.equal(r.summary.count, 1); assert.equal(r.summary.skipped, 2);
});
const badCases = {
  'não é JSON': '{oops', 'outro app': { app: 'x', kind: 'cronograma', schema: 1, activities: [{}] }, 'tipo errado': { app: 'gastos-viagem', kind: 'backup', schema: 1, activities: [] },
  'versão futura': { app: 'gastos-viagem', kind: 'cronograma', schema: 9, activities: [{ date: '2026-12-05', title: 'x' }] },
  'lista vazia': file([]), 'data inválida': file([{ date: '2026-02-30', title: 'x' }]), 'sem título': file([{ date: '2026-12-05', title: ' ' }]),
  'título enorme': file([{ date: '2026-12-05', title: 'x'.repeat(81) }]), 'só mínimo': file([{ date: '2026-12-05', title: 'x', min: 5 }]),
  'mín > máx': file([{ date: '2026-12-05', title: 'x', min: 9, max: 5 }]), 'valor negativo': file([{ date: '2026-12-05', title: 'x', min: -1, max: 5 }]),
  'status inválido': file([{ date: '2026-12-05', title: 'x', status: 'feito' }]), 'participante inexistente': file([{ date: '2026-12-05', title: 'x', participants: ['zz'] }]),
  'participantes vazios': file([{ date: '2026-12-05', title: 'x', participants: [] }]), 'notas enormes': file([{ date: '2026-12-05', title: 'x', notes: 'x'.repeat(601) }]),
  'mais de 300': file(Array.from({ length: 301 }, (_, i) => ({ date: '2026-12-05', title: `a${i}` }))),
};
for (const [nome, input] of Object.entries(badCases)) {
  test(`importação rejeita: ${nome}`, () => {
    const r = parseScheduleImport(input, { people, uid, now: NOW });
    assert.equal(r.ok, false); assert.ok(r.errors.length);
  });
}
test('importação: erro em qualquer item cancela tudo (nada parcial)', () => {
  const r = parseScheduleImport(file([{ date: '2026-12-05', title: 'ok' }, { date: 'xx', title: 'ruim' }]), { people, uid, now: NOW });
  assert.equal(r.ok, false); assert.equal(r.activities, undefined);
});
