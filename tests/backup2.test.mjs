import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBackup, validateBackup, SCHEMA_VERSION } from '../docs/js/backup.js';
import { buildShares, splitEqual } from '../docs/js/split.js';
import { DB_VERSION } from '../docs/js/db.js';

const IDS = ['p1', 'p2', 'p3'];
const people = IDS.map((id, i) => ({ id, name: ['Ana', 'Bia', 'Caio'][i] }));
const shares = buildShares({ mode: 'equal', min: 10000, max: 30000, order: IDS, selected: new Set(IDS) }).shares;
const state = {
  trip: { name: 'V', start: '2026-10-01', end: '2026-10-10', currency: 'USD' }, people,
  entries: [{ id: 'e1', date: '2026-09-20', cents: 100000, description: '', createdAt: '' }],
  activities: [{ id: 'a1', date: '2026-10-03', title: 'Parque', status: 'planned', min: 10000, max: 30000, splitMode: 'equal', createdAt: '', participants: IDS, shares }],
  expenses: [
    { id: 'x1', date: '2026-10-03', cents: 5000, store: '', category: 'passeios', description: '', splitMode: 'equal', createdAt: '', activityId: 'a1', consumers: splitEqual(5000, IDS) },
    { id: 'x2', date: '2026-10-04', cents: 700, store: '', category: 'outros', description: '', splitMode: 'equal', createdAt: '', activityId: null, consumers: splitEqual(700, IDS) },
  ],
};
const good = () => JSON.parse(JSON.stringify(buildBackup(state, new Date(2026, 9, 5))));

test('schema do backup == versão do banco', () => assert.equal(SCHEMA_VERSION, DB_VERSION));
test('ida e volta com cronograma e vínculo', () => {
  const r = validateBackup(JSON.stringify(good()));
  assert.ok(r.ok, r.errors.join('|'));
  assert.deepEqual(r.data.activities, state.activities);
  assert.deepEqual(r.data.expenses.map((x) => x.activityId), ['a1', null]);
  assert.equal(r.summary.activities, 1);
});
test('backup antigo (schema 1, sem cronograma) ainda restaura', () => {
  const old = good();
  old.schema = 1; delete old.activities; old.expenses.forEach((x) => delete x.activityId);
  const r = validateBackup(old);
  assert.ok(r.ok, r.errors.join('|'));
  assert.deepEqual(r.data.activities, []);
  assert.ok(r.data.expenses.every((x) => x.activityId === null));
});
test('backup schema 2 sem a lista de atividades é rejeitado', () => {
  const b = good(); delete b.activities;
  assert.equal(validateBackup(b).ok, false);
});
const bad = {
  'mínimo maior que máximo': (b) => { b.activities[0].min = 40000; },
  'status inválido': (b) => { b.activities[0].status = 'feito'; },
  'título vazio': (b) => { b.activities[0].title = '  '; },
  'data inválida': (b) => { b.activities[0].date = '2026-02-30'; },
  'valor negativo': (b) => { b.activities[0].max = -1; },
  'participante inexistente': (b) => { b.activities[0].participants[0] = 'zz'; },
  'participante repetido': (b) => { b.activities[0].participants = ['p1', 'p1', 'p2']; },
  'sem participantes': (b) => { b.activities[0].participants = []; b.activities[0].shares = []; },
  'divisão não fecha no mínimo': (b) => { b.activities[0].shares[0].min += 1; },
  'divisão não fecha no máximo': (b) => { b.activities[0].shares[1].max -= 1; },
  'parte com mín > máx': (b) => { b.activities[0].shares[0].min = 99999; b.activities[0].shares[0].max = 1; },
  'participante sem parte': (b) => { b.activities[0].shares[0].personId = 'p2'; },
  'id de atividade repetido': (b) => { b.activities.push({ ...b.activities[0] }); },
  'gasto vinculado a atividade inexistente': (b) => { b.expenses[0].activityId = 'nao-existe'; },
};
for (const [nome, fn] of Object.entries(bad)) {
  test(`rejeita: ${nome}`, () => {
    const b = good(); fn(b);
    const r = validateBackup(b);
    assert.equal(r.ok, false); assert.ok(r.errors.length);
  });
}
test('campos desconhecidos em atividades são descartados', () => {
  const b = good(); b.activities[0].segredo = 'x'; b.activities[0].shares[0].extra = 1;
  const r = validateBackup(b);
  assert.ok(r.ok);
  assert.ok(!('segredo' in r.data.activities[0]) && !('extra' in r.data.activities[0].shares[0]));
});
