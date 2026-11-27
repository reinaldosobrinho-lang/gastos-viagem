# Gastos da Viagem (PWA)

App de controle de gastos de viagem, para uso pessoal no iPhone. Sem backend; os dados ficam no IndexedDB do aparelho.

## Publicar no GitHub Pages
1. O código já está na branch `main` deste repositório.
2. No repositório: **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Branch **main**, pasta **/docs** → *Save*.
4. Aguarde ~1 min. O endereço será `https://<seu-usuario>.github.io/gastos-viagem/`.

## Instalar no iPhone
1. Abra o endereço **no Safari**.
2. Toque em Compartilhar → **Adicionar à Tela de Início** → *Adicionar*.
3. Abra pelo ícone novo. **Use sempre o app instalado**: os dados do Safari e os do app instalado são separados.
4. Se já lançou algo no Safari antes de instalar, esses dados não aparecem no app instalado (exporte/restaure o backup).

## Testar offline
1. Abra o app instalado com internet uma vez (isso grava o app no aparelho).
2. Ative o **Modo Avião**, feche o app (deslize para cima) e abra de novo.
3. Lance um gasto: deve funcionar normalmente. Feche e reabra: o gasto continua lá.

## Atualizar o app (sem perder dados)
Ao publicar uma versão nova, abra o app com internet: aparece a faixa **"Nova versão disponível → Atualizar"**. Os dados não são tocados.
Para o desenvolvedor: a cada release, aumente `VERSION` em `sw.js` **e** `APP_VERSION` em `js/version.js` (um teste confere). Mudou o formato dos dados? Aumente `DB_VERSION` e adicione a migração em `js/db.js`.

## Importar um cronograma
Cronograma > **Importar cronograma (.json)**. O arquivo traz as atividades (data, título, ícone, observações; valores são opcionais).
Só **adiciona**: nada existente é apagado, e atividades com a mesma data e título são ignoradas. Atividades sem valor previsto não entram na previsão até você preencher mínimo e máximo.
Formato (valores em centavos; `participants` omitido = as 3 pessoas):
```json
{ "app": "gastos-viagem", "kind": "cronograma", "schema": 1,
  "activities": [ { "date": "2026-12-05", "title": "Parque", "icon": "🎢", "notes": "obs", "min": 10000, "max": 30000 } ] }
```
**Não publique no repositório um cronograma real** (endereços, reservas): ele é importado pelo app e fica só no aparelho.

## Notas fiscais (sem custo, sem IA)
Gastos > **📷 Nota fiscal**: tire a foto ou escolha da galeria (ela é comprimida e fica só no aparelho) ou lance sem foto.
A foto é só referência: **você digita** os itens, impostos, descontos e gorjeta na tela de revisão. Não há leitura automática, API paga, chave ou servidor.
- Cada item é atribuído a uma ou mais pessoas (o app não adivinha) e pode ser dividido por quantidade.
- Impostos adicionados, descontos e gorjeta são rateados proporcionalmente; imposto marcado como "já incluído" não é somado de novo.
- Só confirma se as partes fecharem com o total impresso. Uma nota gera **um único gasto**; avisa se houver gasto na mesma data com o mesmo valor.
- Moeda da nota diferente da viagem: você informa o valor convertido.
- Notas **pendentes** ainda não entram no saldo. **O backup não inclui as fotos**, só os dados.

## Calculadora de gorjeta
Gastos > **🧮 Calcular gorjeta** (e o botão **🧮 Calcular gorjeta** dentro da nota). Digite o valor da conta que entregaram (com imposto) e, se quiser, o imposto: o app mostra 3 opções (padrão **18%, 20% e 25%**) com a gorjeta e o total a pagar.
Por padrão calcula sobre o valor **antes do imposto**; desmarque para calcular sobre a conta inteira. Os percentuais podem ser mudados em "Mudar os percentuais" (ficam salvos só neste aparelho, fora do backup).
**Criar nota com esta gorjeta** já abre a nota com a gorjeta, o total e o imposto preenchidos; falta só digitar os itens.
Não existe percentual obrigatório nos EUA; confira se a conta já tem "gratuity" ou "service charge".

## Backup
Ajustes → **Exportar backup**: salve o `.json` em Arquivos/iCloud. Restaurar valida o arquivo e pede confirmação antes de sobrescrever. Faça um backup antes e depois da viagem.

## Testes (no computador)
- `npm test` — cálculos, divisões, datas, backup e consistência do PWA.
- `NODE_PATH=$(npm root -g) node tests/e2e-smoke.cjs` — fluxo da Fase 1 no Chromium (precisa do Playwright).
- `NODE_PATH=$(npm root -g) node tests/e2e-gorjeta.cjs` — calculadora de gorjeta.
- `NODE_PATH=$(npm root -g) node tests/e2e-notas.cjs` — notas fiscais (dados fictícios).
- `NODE_PATH=$(npm root -g) node tests/e2e-valores.cjs` — tela "Definir valores" (dados fictícios).
- `NODE_PATH=$(npm root -g) node tests/e2e-cronograma.cjs` — importação, ícones e linha do tempo (dados fictícios).
- `NODE_PATH=$(npm root -g) node tests/e2e-fase2.cjs` — Fase 2 e atualização da v1 para a v2 com dados gravados.
