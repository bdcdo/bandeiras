# Bandeiras

Site para aprender as 193 bandeiras da ONU ao modo Math Academy, sobre um núcleo genérico de repetição espaçada.

- Comandos: `pnpm dev`, `pnpm test` (laço rápido), `pnpm verify` (porta única: tipos, lint, formato, DAG, contraste, testes, e2e).
- Três pacotes: `packages/nucleo` (motor puro, genérico, zero dependências), `packages/dominio-bandeiras` (dados, curadoria, imagens, adaptador `Dominio`), `apps/web` (casca Vite e React). A casca importa o domínio só em `apps/web/src/dominio.ts`.
- Camadas do núcleo e fronteiras entre pacotes vivem em `.dependency-cruiser.cjs` e no `eslint.config.js`; a regra que importa está lá, não aqui.
- Dados gerados são commitados: `pnpm gerar:dados` roda à mão, nunca no install nem no CI, e o teste de dados valida o commitado. Imagem que mudou exige conferência à mão e hash atualizado no mesmo commit.
- Identificadores, comentários, commits e interface em pt-BR; comentários explicam mecânica e decisão.
