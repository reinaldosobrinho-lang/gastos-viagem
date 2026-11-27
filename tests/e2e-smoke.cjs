// Teste de fumaça no Chromium (emulando iPhone 13). Não substitui testar no iPhone/Safari real.
// Uso: NODE_PATH=$(npm root -g) node tests/e2e-smoke.cjs [pasta-de-screenshots]
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert/strict');
const root = path.join(__dirname, '..', 'docs');
const shots = process.argv[2];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f));
});
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

(async () => {
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'pt-BR', deviceScaleFactor: 2, colorScheme: 'light' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const shot = (n) => shots && page.screenshot({ path: path.join(shots, n + '.png') });
  const text = () => page.locator('#app').innerText();

  await page.goto(url); await page.waitForSelector('#setupForm');
  await shot('1-setup');
  // validação: fim antes do início
  await page.fill('[name=name]', 'Viagem de teste');
  await page.fill('[name=start]', addDays(5)); await page.fill('[name=end]', addDays(1));
  await page.selectOption('[name=currency]', 'USD');
  await page.fill('[name=p0]', 'Ana'); await page.fill('[name=p1]', 'Bia'); await page.fill('[name=p2]', 'Caio');
  await page.click('#setupForm button[type=submit]');
  assert.match(await page.locator('#setupErr').innerText(), /anterior/);
  // viagem em andamento: começou há 2 dias, termina em 7 (10 dias; restam 8 contando hoje)
  await page.fill('[name=start]', addDays(-2)); await page.fill('[name=end]', addDays(7));
  await page.click('#setupForm button[type=submit]');
  await page.waitForSelector('#tabs:not([hidden])');
  assert.match(await text(), /Ainda não há saldo/);

  // entrada de saldo 1.000,00
  await page.click('[data-tab=saldo]'); await page.click('[data-act=new-entry]');
  await page.fill('#eAmount', '1000,00'); await page.fill('#eDesc', 'caixa'); await page.click('#entForm button[type=submit]');
  await page.waitForSelector('#sheet[hidden]', { state: 'attached' });

  // gasto sem pessoas -> erro
  await page.click('[data-tab=gastos]'); await page.click('[data-act=new-expense]');
  await page.fill('#fAmount', '100,01'); await page.click('#expForm button[type=submit]');
  assert.match(await page.locator('#fErr').innerText(), /quem consumiu/);
  // igual entre 3: 33,34 / 33,33 / 33,34? (100,01 -> 3334,3334,3333 centavos)
  await page.click('[data-all]');
  await shot('2-expense-equal');
  const prev = await page.locator('[data-prev]').allInnerTexts();
  assert.deepEqual(prev.map((s) => s.replace(/\s/g, ' ')), ['US$ 33,34', 'US$ 33,34', 'US$ 33,33']);
  // por valores com soma errada -> bloqueia
  await page.click('[data-mode=custom]');
  const inputs = page.locator('input.cust'); await inputs.nth(0).fill('50'); await inputs.nth(1).fill('30'); await inputs.nth(2).fill('20,00');
  await shot('3-expense-custom');
  await page.click('#expForm button[type=submit]');
  assert.match(await page.locator('#fErr').innerText(), /somam/);
  await inputs.nth(2).fill('20,01'); await page.fill('#fStore', 'Loja <b>x</b>');
  await page.click('#expForm button[type=submit]');
  await page.waitForSelector('.item');
  assert.match(await text(), /Loja <b>x<\/b>/); // texto escapado, não interpretado como HTML

  // painel: saldo 1000,00-100,01 = 899,99; hoje = 100,01; limite=(89999+10001)/8=12500
  await page.click('[data-tab=painel]');
  const painel = (await text()).replace(/\s/g, ' ');
  assert.match(painel, /Saldo disponível\s*US\$ 899,99/);
  assert.match(painel, /Limite diário\s*US\$ 125,00/);
  assert.match(painel, /Resta hoje\s*US\$ 24,99/);
  assert.match(painel, /Ana\s*US\$ 50,00/);
  await shot('4-painel');

  // persistência + offline
  await page.reload(); await page.waitForSelector('#tabs:not([hidden])');
  assert.match((await text()).replace(/\s/g, ' '), /US\$ 899,99/);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await page.waitForFunction(() => navigator.serviceWorker.controller);
  await ctx.setOffline(true);
  await page.reload(); await page.waitForSelector('#tabs:not([hidden])');
  assert.match((await text()).replace(/\s/g, ' '), /US\$ 899,99/);
  await page.click('[data-tab=gastos]'); await page.click('[data-act=new-expense]');
  await page.fill('#fAmount', '10'); await page.click('[data-pid=p2]'); await page.click('#expForm button[type=submit]');
  await page.waitForSelector('#sheet[hidden]', { state: 'attached' });
  await ctx.setOffline(false);

  // backup: exporta (download) e restaura
  await page.click('[data-tab=ajustes]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=export]')]);
  const file = path.join(require('os').tmpdir(), 'bk.json'); await dl.saveAs(file);
  const bk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(bk.expenses.length, 2); assert.equal(bk.entries[0].cents, 100000);
  // apaga um gasto, restaura e confere que voltou
  await page.click('[data-tab=gastos]'); await page.locator('.item').first().click();
  await page.click('#fDel'); await page.click('[data-ok]'); await page.waitForTimeout(150);
  assert.equal(await page.locator('.item').count(), 1);
  await page.click('[data-tab=ajustes]');
  const bad = path.join(require('os').tmpdir(), 'bad.json'); fs.writeFileSync(bad, '{"app":"gastos-viagem","schema":1}');
  await page.setInputFiles('#filePicker', bad);
  await page.waitForSelector('.dlg'); assert.match(await page.locator('.dlg').innerText(), /inválido/); await page.click('[data-ok]');
  await page.setInputFiles('#filePicker', file);
  await page.waitForSelector('.dlg'); await shot('5-restore-confirm');
  assert.match(await page.locator('.dlg').innerText(), /sobrescreve/);
  await page.click('[data-ok]'); await page.waitForTimeout(300);
  await page.click('[data-tab=gastos]');
  assert.equal(await page.locator('.item').count(), 2);

  // modo escuro e atualização do SW sem perder dados
  await page.emulateMedia({ colorScheme: 'dark' }); await page.click('[data-tab=painel]'); await shot('6-dark');
  console.log('erros de console/página:', errors.length ? errors : 'nenhum');
  assert.equal(errors.length, 0);
  console.log('E2E OK');
  await browser.close(); server.close();
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
