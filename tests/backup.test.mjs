import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildBackup, validateBackup, SCHEMA_VERSION, APP_ID } from '../docs/js/backup.js';
import { splitEqual } from '../docs/js/split.js';
import { DB_VERSION } from '../docs/js/db.js';
import { APP_VERSION } from '../docs/js/version.js';

const people = [{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Bia' }, { id: 'p3', name: 'Caio' }];
const state = {
  trip: { name: 'Viagem teste', start: '2026-10-01', end: '2026-10-10', currency: 'USD' },
  people,
  entries: [{ id: 'e1', date: '2026-09-20', cents: 100000, description: 'caixa', createdAt: '2026-09-20T10:00:00' }],
  expenses: [
    { id: 'x1', date: '2026-10-02', cents: 1001, store: 'Loja', category: 'compras', description: '', splitMode: 'equal', createdAt: '', consumers: splitEqual(1001, ['p1', 'p2', 'p3']) },
    { id: 'x2', date: '2026-10-03', cents: 500, store: '', category: 'outros', description: 'x', splitMode: 'custom', createdAt: '', consumers: [{ personId: 'p2', cents: 500 }] },
  ],
};
const clone = (o) => JSON.parse(JSON.stringify(o));
const good = () => clone(buildBackup(state, new Date(2026, 9, 5, 12, 0, 0)));

test('exporta e valida de volta (ida e volta sem perdas)', () => {
  const b = good();
  assert.equal(b.app, APP_ID); assert.equal(b.schema, SCHEMA_VERSION);
  assert.equal(b.exportedAt, '2026-10-05T12:00:00');
  const r = validateBackup(JSON.stringify(b));
  assert.ok(r.ok, r.errors.join('|'));
  assert.deepEqual(r.data.trip, state.trip);
  assert.deepEqual(r.data.entries.map((e) => e.cents), [100000]);
  assert.deepEqual(r.data.expenses.map((x) => x.consumers), state.expenses.map((x) => x.consumers));
  assert.equal(r.summary.expenses, 2);
});
test('backup não carrega campos desconhecidos (sanitização)', () => {
  const b = good(); b.token = 'segredo'; b.expenses[0].extra = 1; b.trip.apiKey = 'x';
  const r = validateBackup(b);
  assert.ok(r.ok);
  assert.ok(!('extra' in r.data.expenses[0]) && !('apiKey' in r.data.trip));
});
test('rejeita JSON quebrado, tipo errado e versão futura', () => {
  assert.ok(!validateBackup('{oops').ok);
  assert.ok(!validateBackup('[]').ok);
  assert.ok(!validateBackup('null').ok);
  assert.ok(!validateBackup({ app: 'outro', schema: 1 }).ok);
  const b = good(); b.schema = SCHEMA_VERSION + 1;
  assert.match(validateBackup(b).errors[0], /mais nova/);
  const c = good(); delete c.schema;
  assert.ok(!validateBackup(c).ok);
});
const mutations = {
  'soma das partes diferente do total': (b) => { b.expenses[0].consumers[0].cents += 1; },
  'consumidor inexistente': (b) => { b.expenses[0].consumers[0].personId = 'zz'; },
  'consumidor repetido': (b) => { b.expenses[0].consumers = [{ personId: 'p1', cents: 500 }, { personId: 'p1', cents: 501 }]; },
  'sem consumidores': (b) => { b.expenses[0].consumers = []; },
  'valor zero': (b) => { b.expenses[0].cents = 0; },
  'valor fracionado': (b) => { b.entries[0].cents = 10.5; },
  'valor como texto': (b) => { b.entries[0].cents = '1000'; },
  'data inexistente': (b) => { b.expenses[0].date = '2026-02-30'; },
  'categoria desconhecida': (b) => { b.expenses[0].category = 'xyz'; },
  'modo de divisão inválido': (b) => { b.expenses[0].splitMode = 'magico'; },
  'id duplicado': (b) => { b.expenses[1].id = 'x1'; },
  'fim antes do início': (b) => { b.trip.end = '2026-09-01'; },
  'moeda inválida': (b) => { b.trip.currency = 'ZZZ'; },
  'apenas 2 pessoas': (b) => { b.people.pop(); },
  'ids de pessoas trocados': (b) => { b.people[0].id = 'a'; },
  'nomes iguais': (b) => { b.people[1].name = 'ana'; },
  'lista de gastos ausente': (b) => { delete b.expenses; },
  'entradas não é lista': (b) => { b.entries = {}; },
};
for (const [nome, fn] of Object.entries(mutations)) {
  test(`rejeita: ${nome}`, () => {
    const b = good(); fn(b);
    const r = validateBackup(b);
    assert.equal(r.ok, false); assert.ok(r.errors.length > 0);
  });
}
test('SCHEMA_VERSION do backup acompanha DB_VERSION do banco', () => assert.equal(SCHEMA_VERSION, DB_VERSION));

/* ---------- consistência do PWA (service worker, manifest, caminhos relativos) ---------- */
const docs = new URL('../docs/', import.meta.url).pathname;
const read = (f) => readFileSync(join(docs, f), 'utf8');
const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

test('VERSION do sw.js == APP_VERSION', () => {
  assert.equal(read('sw.js').match(/const VERSION = '([^']+)'/)[1], APP_VERSION);
});
test('todos os arquivos do app estão no cache do service worker (e existem)', () => {
  const assets = [...read('sw.js').matchAll(/'\.\/([^']*)'/g)].map((m) => m[1] || 'index.html');
  for (const a of assets) assert.ok(existsSync(join(docs, a)), `falta ${a}`);
  const all = walk(docs).map((p) => relative(docs, p)).filter((f) => !['sw.js', 'package.json'].includes(f));
  for (const f of all) assert.ok(assets.includes(f), `${f} não está no cache offline`);
});
test('manifest e index.html usam só caminhos relativos (GitHub Pages)', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.start_url, './'); assert.equal(m.scope, './'); assert.equal(m.display, 'standalone'); assert.equal(m.lang, 'pt-BR');
  for (const i of m.icons) assert.ok(!i.src.startsWith('/') && existsSync(join(docs, i.src)));
  const html = read('index.html');
  for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(!url.startsWith('/') && !/^https?:/.test(url), `caminho não relativo: ${url}`);
  for (const f of walk(docs).filter((p) => p.endsWith('.js'))) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!/(from|import)\s*\(?\s*['"]\//.test(src), `${f} importa com caminho absoluto`);
  }
});
test('nenhum segredo óbvio no código publicado', () => {
  for (const f of walk(docs).filter((p) => /\.(js|html|css|webmanifest)$/.test(p))) {
    assert.ok(!/(sk-ant-|api[_-]?key\s*[:=]\s*['"][^'"]{8,}|AKIA[0-9A-Z]{12,})/i.test(readFileSync(f, 'utf8')), f);
  }
});
