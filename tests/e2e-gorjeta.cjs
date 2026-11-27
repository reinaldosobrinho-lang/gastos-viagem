// Calculadora de gorjeta no Chromium (iPhone 13 emulado). Dados FICTÍCIOS.
// Uso: NODE_PATH=$(npm root -g) node tests/e2e-gorjeta.cjs [pasta-de-screenshots]
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
  const shot = (n) => shots && page.screenshot({ path: path.join(shots, n + '.png') });
  const opts = async () => (await page.locator('.tc-opt').allInnerTexts()).map(norm);
  const closed = () => page.waitForSelector('#sheet[hidden]', { state: 'attached' });
  await page.goto(`http://localhost:${server.address().port}/`); await page.waitForSelector('#setupForm');
  await page.fill('[name=name]', 'Teste'); await page.fill('[name=start]', addDays(-1)); await page.fill('[name=end]', addDays(5));
  await page.fill('[name=p0]', 'Ana'); await page.fill('[name=p1]', 'Bia'); await page.fill('[name=p2]', 'Caio');
  await page.click('#setupForm button[type=submit]'); await page.waitForSelector('#tabs:not([hidden])');
  await page.click('[data-tab=gastos]');

  /* calculadora sozinha */
  await page.click('[data-act=tip-calc]'); await page.waitForSelector('.tc-bill');
  assert.match(norm(await page.locator('.tc-opts').innerText()), /Digite o valor da conta/);
  assert.match(norm(await page.locator('.tipcalc').innerText()), /gratuity.*service charge/);
  await page.fill('.tc-bill', '87,40'); await page.fill('.tc-tax', '6,40');
  let o = await opts();
  assert.match(o[0], /18%\s*US\$ 14,58\s*total US\$ 101,98/); assert.match(o[1], /20%\s*US\$ 16,20\s*total US\$ 103,60/); assert.match(o[2], /25%\s*US\$ 20,25\s*total US\$ 107,65/);
  assert.match(norm(await page.locator('.tc-opts').innerText()), /Gorjeta sobre US\$ 81,00 \(conta sem o imposto\)/);
  await page.uncheck('.tc-pre'); o = await opts();                                   // sobre a conta inteira
  assert.match(o[0], /18%\s*US\$ 15,73\s*total US\$ 103,13/); assert.match(o[1], /20%\s*US\$ 17,48/); assert.match(o[2], /25%\s*US\$ 21,85/);
  await page.check('.tc-pre');
  await page.fill('.tc-tax', '90'); assert.match(norm(await page.locator('.tc-opts').innerText()), /imposto não pode ser maior/);
  await page.fill('.tc-tax', '6,40'); await page.fill('.tc-bill', '8a'); assert.match(norm(await page.locator('.tc-opts').innerText()), /Valor inválido/);
  await page.fill('.tc-bill', '87,40');
  // escolher 20%
  await page.locator('.tc-opt').nth(1).click();
  assert.match(norm(await page.locator('.tc-pick').innerText()), /20% = gorjeta US\$ 16,20, você paga US\$ 103,60/);
  await shot('g1-calculadora');
  // percentuais editáveis e lembrados
  await page.click('.tc-edit summary');
  await page.locator('.tc-pct').nth(0).fill('15'); await page.locator('.tc-pct').nth(2).fill('22');
  o = await opts(); assert.match(o[0], /15%\s*US\$ 12,15/); assert.match(o[2], /22%\s*US\$ 17,82/); // 81,00*0,15 ; 81,00*0,22
  await page.locator('.tc-pct').nth(1).fill('abc'); assert.equal(await page.locator('.tc-pcterr').isVisible(), true);
  await page.locator('.tc-pct').nth(1).fill('18');
  await page.click('#sheet [data-close]');
  await page.click('[data-act=tip-calc]'); await page.waitForSelector('.tc-bill'); await page.fill('.tc-bill', '50');
  o = await opts(); assert.match(o[0], /15%\s*US\$ 7,50/); assert.match(o[1], /18%\s*US\$ 9,00/); assert.match(o[2], /22%\s*US\$ 11,00/); // lembrou 15/18/22
  await page.click('.tc-edit summary');
  for (const [i, v] of [[0, 18], [1, 20], [2, 25]]) await page.locator('.tc-pct').nth(i).fill(String(v)); // volta ao padrão

  /* criar nota já com a gorjeta */
  await page.fill('.tc-bill', '87,40'); await page.fill('.tc-tax', '6,40');
  await page.locator('.tc-opt').nth(1).click();
  await page.click('.tc-actions [data-first]'); await page.waitForSelector('#rcForm');
  assert.equal(await page.locator('#rcTip').inputValue(), '16,20');
  assert.equal(await page.locator('#rcTotal').inputValue(), '103,60');
  assert.equal(await page.locator('.tx-val').first().inputValue(), '6,40');
  let sum = norm(await page.locator('#rcSummary').innerText());
  assert.match(sum, /Para confirmar, falta/); // ainda faltam os itens
  await page.fill('#rcStore', 'Restaurante Teste');
  await page.click('[data-add-item]'); await page.locator('.it-name').fill('Jantar'); await page.locator('.it-price').fill('81'); await page.locator('[data-all-p]').click();
  sum = norm(await page.locator('#rcSummary').innerText());
  assert.match(sum, /Total calculado\s*US\$ 103,60/); assert.match(sum, /Tudo fecha/); // 81,00 + 6,40 de imposto + 16,20 de gorjeta
  await shot('g2-nota-com-gorjeta');
  console.log('erros de console/página:', errors.length ? errors : 'nenhum');
  assert.equal(errors.length, 0);

  /* a mesma calculadora dentro da tela da nota: parte dos itens digitados */
  await page.click('#rcDel'); await page.click('[data-ok]'); await closed();
  await page.click('[data-act=new-note]'); await page.click('#nNone'); await page.waitForSelector('#rcForm');
  await page.click('[data-add-item]'); await page.locator('.it-name').fill('Pizza'); await page.locator('.it-price').fill('50'); await page.locator('[data-p=p1]').click();
  await page.click('[data-add-tax]'); await page.locator('.tx-val').first().fill('4');
  await page.click('#rcTipCalc'); await page.waitForSelector('#rcTipBox .tc-bill');
  assert.equal(await page.locator('#rcTipBox .tc-bill').inputValue(), '54,00'); // itens + imposto adicionado
  assert.equal(await page.locator('#rcTipBox .tc-tax').inputValue(), '4,00');
  let ob = (await page.locator('#rcTipBox .tc-opt').allInnerTexts()).map(norm);
  assert.match(ob[1], /20%\s*US\$ 10,00\s*total US\$ 64,00/); // base 50,00
  await page.locator('#rcTipBox .tc-opt').nth(1).click(); await page.click('#rcTipBox .tc-actions [data-first]');
  assert.equal(await page.locator('#rcTip').inputValue(), '10,00');
  assert.equal(await page.locator('#rcTipBox').isHidden(), true);
  await page.fill('#rcTotal', '64');
  assert.match(norm(await page.locator('#rcSummary').innerText()), /Tudo fecha/);
  console.log('E2E GORJETA OK');
  await browser.close(); server.close();
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
