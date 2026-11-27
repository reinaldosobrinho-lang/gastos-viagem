// Tela "Definir valores" no Chromium (iPhone 13 emulado), dados FICTÍCIOS.
// Uso: NODE_PATH=$(npm root -g) node tests/e2e-valores.cjs [pasta-de-screenshots]
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert/strict');
const root = path.join(__dirname, '..', 'docs');
const shots = process.argv[2];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, r) => { let p = q.url.split('?')[0]; if (p.endsWith('/')) p += 'index.html'; const f = path.join(root, p);
  if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'x', 'cache-control': 'no-store' }); r.end(fs.readFileSync(f)); });
const pad = (n) => String(n).padStart(2, '0');
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const norm = (s) => s.replace(/\s/g, ' ');
(async () => {
  await new Promise((r) => server.listen(0, r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'pt-BR', deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const text = async () => norm(await page.locator('#app').innerText());
  await page.goto(`http://localhost:${server.address().port}/`); await page.waitForSelector('#setupForm');
  await page.fill('[name=name]', 'Teste'); await page.fill('[name=start]', addDays(0)); await page.fill('[name=end]', addDays(5));
  await page.fill('[name=p0]', 'Ana'); await page.fill('[name=p1]', 'Bia'); await page.fill('[name=p2]', 'Caio');
  await page.click('#setupForm button[type=submit]'); await page.waitForSelector('#tabs:not([hidden])');
  await page.click('[data-tab=saldo]'); await page.click('[data-act=new-entry]'); await page.fill('#eAmount', '5000'); await page.click('#entForm button[type=submit]');
  await page.waitForSelector('#sheet[hidden]', { state: 'attached' });
  await page.click('[data-tab=crono]');
  await page.click('[data-act=paste-schedule]');
  await page.fill('#pText', JSON.stringify({ app: 'gastos-viagem', kind: 'cronograma', schema: 1, activities: [
    { date: addDays(1), title: 'Parque' }, { date: addDays(2), title: 'Parque' }, { date: addDays(3), title: 'Parque' }, { date: addDays(3), title: 'Jantar', participants: ['p1', 'p2'] }] }));
  await page.click('#pasteForm button[type=submit]'); await page.waitForSelector('.dlg'); await page.click('[data-ok]');
  await page.waitForFunction(() => /4 atividades planejadas sem valor previsto/.test(document.querySelector('#app').innerText));
  assert.match(await text(), /4 atividades planejadas sem valor previsto/);

  await page.click('.alert [data-act=bulk-price]'); await page.waitForSelector('#bulkForm');
  assert.equal(await page.locator('.brow').count(), 4);
  // nada preenchido
  await page.click('#bulkForm button[type=submit]');
  assert.match(await page.locator('#bErr').innerText(), /pelo menos uma/);
  // só um campo -> erro com o nome
  const rows = page.locator('.brow');
  await rows.nth(0).locator('[data-k=min]').fill('100'); await rows.nth(0).locator('[data-k=min]').dispatchEvent('change');
  await page.click('#bulkForm button[type=submit]');
  assert.match(await page.locator('#bErr').innerText(), /"Parque".*preencha mínimo e máximo/);
  // completa o 1º "Parque": as outras 2 (mesmo nome, vazias) recebem os valores; "Jantar" não
  await rows.nth(0).locator('[data-k=max]').fill('150'); await rows.nth(0).locator('[data-k=max]').dispatchEvent('change');
  assert.equal(await rows.nth(1).locator('[data-k=min]').inputValue(), '100');
  assert.equal(await rows.nth(2).locator('[data-k=max]').inputValue(), '150');
  assert.equal(await rows.nth(3).locator('[data-k=min]').inputValue(), '');
  // por pessoa: Parque x3 pessoas = 300 a 450 cada; 3 atividades = 900 a 1.350
  await page.click('[data-per=person]');
  assert.match(norm(await page.locator('#bulkSum').innerText()), /3 atividade\(s\) preenchida\(s\): planejado total de US\$ 900,00 a US\$ 1\.350,00/);
  // ajusta um dos Parque manualmente: o autopreenchimento não sobrescreve o que já foi preenchido
  await rows.nth(1).locator('[data-k=max]').fill('200'); await rows.nth(1).locator('[data-k=max]').dispatchEvent('change');
  assert.equal(await rows.nth(2).locator('[data-k=max]').inputValue(), '150');
  if (shots) await page.screenshot({ path: path.join(shots, 'v1-valores.png') });
  await rows.nth(3).locator('[data-k=min]').fill('40'); await rows.nth(3).locator('[data-k=max]').fill('60');
  await page.click('#bulkForm button[type=submit]'); await page.waitForSelector('#sheet[hidden]', { state: 'attached' });

  const t = await text();
  assert.doesNotMatch(t, /atividades? planejadas? sem valor previsto/); // o aviso some: todas com valor agora
  assert.match(t, /Planejado no dia\s*US\$ 300,00 a US\$ 450,00/);             // dia 1 (Parque, 3 pessoas)
  assert.match(t, /Planejado no dia\s*US\$ 300,00 a US\$ 600,00/);             // dia 2 (Parque ajustado: 100 a 200 por pessoa)
  assert.match(t, /Planejado no dia\s*US\$ 380,00 a US\$ 570,00/);             // dia 3 (Parque 300-450 + Jantar 80-120)
  assert.match(t, /Previsão restante \(mín\. a máx\.\)\s*US\$ 980,00 a US\$ 1\.620,00/); // soma de tudo
  assert.match(t, /Saldo projetado · cenário mínimo\s*US\$ 4\.020,00/);
  // persistência
  await page.reload(); await page.waitForSelector('[data-tab=crono]'); await page.click('[data-tab=crono]');
  assert.match(await text(), /US\$ 980,00 a US\$ 1\.620,00/);
  // com todas preenchidas, o botão avisa
  await page.click('[data-act=bulk-price]'); await page.waitForTimeout(200);
  assert.match(await page.locator('#toast').innerText(), /já têm valor/);
  console.log('erros de console/página:', errors.length ? errors : 'nenhum');
  assert.equal(errors.length, 0);
  console.log('E2E VALORES OK');
  await browser.close(); server.close();
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
