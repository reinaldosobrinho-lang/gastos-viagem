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

## Backup
Ajustes → **Exportar backup**: salve o `.json` em Arquivos/iCloud. Restaurar valida o arquivo e pede confirmação antes de sobrescrever. Faça um backup antes e depois da viagem.

## Testes (no computador)
- `npm test` — cálculos, divisões, datas, backup e consistência do PWA.
- `NODE_PATH=$(npm root -g) node tests/e2e-smoke.cjs` — fluxo da Fase 1 no Chromium (precisa do Playwright).
- `NODE_PATH=$(npm root -g) node tests/e2e-valores.cjs` — tela "Definir valores" (dados fictícios).
- `NODE_PATH=$(npm root -g) node tests/e2e-cronograma.cjs` — importação, ícones e linha do tempo (dados fictícios).
- `NODE_PATH=$(npm root -g) node tests/e2e-fase2.cjs` — Fase 2 e atualização da v1 para a v2 com dados gravados.
