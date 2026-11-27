import test from 'node:test';
import assert from 'node:assert/strict';
import { applyBulkPrices } from '../docs/js/bulk-price.js';
import { parseMoney } from '../docs/js/money.js';

const order = ['p1', 'p2', 'p3'];
const mk = (id, title, participants = order) => ({ id, title, date: '2026-12-05', status: 'planned', min: null, max: null, icon: '', notes: '', splitMode: 'equal', createdAt: '', participants, shares: [] });
const acts = [mk('a', 'Epic'), mk('b', 'Epic'), mk('c', 'Jantar', ['p1', 'p2'])];
const parse = (t) => parseMoney(t, 'USD');
const run = (values, per = 'total') => applyBulkPrices({ activities: acts, values, per, order, parse });

test('total da atividade: grava mín/máx e divide igualmente entre participantes', () => {
  const r = run({ a: { min: '300', max: '450,01' } });
  assert.ok(r.ok);
  assert.equal(r.updated.length, 1);
  const a = r.updated[0];
  assert.deepEqual([a.min, a.max], [30000, 45001]);
  assert.equal(a.shares.reduce((n, s) => n + s.max, 0), 45001);
  assert.equal(a.shares.reduce((n, s) => n + s.min, 0), 30000);
  assert.deepEqual(r.total, { min: 30000, max: 45001 });
});
test('por pessoa: multiplica pelo número de participantes', () => {
  const r = run({ a: { min: '100', max: '150' }, c: { min: '40', max: '60' } }, 'person');
  assert.ok(r.ok);
  const by = Object.fromEntries(r.updated.map((x) => [x.id, x]));
  assert.deepEqual([by.a.min, by.a.max], [30000, 45000]); // 3 pessoas
  assert.deepEqual([by.c.min, by.c.max], [8000, 12000]);  // 2 pessoas
  assert.deepEqual(r.total, { min: 38000, max: 57000 });
});
test('em branco continua sem valor; nada preenchido devolve lista vazia', () => {
  const r = run({ a: { min: '', max: '  ' } });
  assert.ok(r.ok); assert.deepEqual(r.updated, []);
});
test('erros: só um campo, valor inválido, mín > máx', () => {
  assert.equal(run({ a: { min: '10', max: '' } }).ok, false);
  assert.equal(run({ a: { min: 'abc', max: '10' } }).ok, false);
  assert.equal(run({ a: { min: '20', max: '10' } }).ok, false);
  const r = run({ a: { min: '20', max: '10' }, b: { min: '5', max: '' } });
  assert.equal(r.errors.length, 2);
  assert.ok(r.errors.every((e) => e.includes('Epic')));
});
test('não altera as atividades originais (sem efeitos colaterais)', () => {
  run({ a: { min: '1', max: '2' } });
  assert.equal(acts[0].min, null);
});
test('zero é um valor válido (atividade gratuita)', () => {
  const r = run({ c: { min: '0', max: '0' } });
  assert.ok(r.ok); assert.deepEqual([r.updated[0].min, r.updated[0].max], [0, 0]);
});
