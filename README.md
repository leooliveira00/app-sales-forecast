# Sales Forecast Web

Plataforma full-stack de **gestão de forecast de vendas**, construída para substituir
o processo manual em planilhas por um fluxo colaborativo com aprovação e previsão
assistida por IA.

> Projeto de portfólio. Os dados de exemplo (usuários, produtos, vendas, orçamento)
> são inteiramente fictícios e gerados por script de seed — não há nenhum dado real
> de nenhuma empresa neste repositório.

## O problema que o sistema resolve

Empresas com múltiplas unidades/divisões de vendas costumam consolidar previsões
mensais de venda em planilhas soltas por e-mail: cada gestor de unidade preenche a
sua, alguém consolida manualmente, aprova por fora do arquivo e não há histórico
confiável de quem mudou o quê. O **Sales Forecast Web** substitui esse processo por
um fluxo único com estado, papéis e trilha de auditoria:

1. **Gestores** de cada unidade de venda preenchem os volumes mensais previstos
   (FCTS) por produto, com sugestão inicial gerada por modelos de série temporal.
2. **PCP** revisa e aprova ou rejeita a submissão de cada unidade.
3. Um motor de **forecast por IA** (rodando em Airflow) recalcula periodicamente as
   projeções, testando múltiplos modelos por série e escolhendo o de menor erro.
4. Dashboards consolidados comparam Orçado × Forecast × Vendas realizadas, com
   indicadores de acurácia e viés por unidade, produto e período.

## Funcionalidades principais

- **Fluxo de aprovação por ciclo** — rascunho → submissão → aprovação/rejeição,
  por unidade de venda e mês de referência, com motivo de rejeição registrado.
- **Forecast assistido por IA** — motor batch (Airflow + Python) que testa 6
  modelos de série temporal por produto/unidade (Holt, ARIMA, AutoARIMA, Winters,
  Theta, Croston) e seleciona o de menor erro (sMAPE).
- **Multi-run com janela editável** — cada execução de forecast cobre uma janela
  de meses; quando janelas de execuções diferentes se sobrepõem, o sistema resolve
  automaticamente qual delas "vence" para cada mês.
- **Suporte a unidades de exportação** — unidades nacionais têm uma linha por
  produto/mês; unidades de exportação abrem uma dimensão adicional por país.
- **Controle de ciclo (gate)** — abertura do ciclo mensal para os gestores é
  condicionada à conclusão de jobs externos (ex.: sincronização de dados), com
  notificações in-app quando o ciclo abre, trava ou é reprocessado.
- **Dashboards consolidados** — comparação Orçado × Forecast × Vendas por unidade,
  produto/família e período, com tabelas pré-computadas (snapshots) para consultas
  rápidas em vez de agregações ao vivo.
- **Trilha de auditoria append-only** — toda mutação relevante (quem, o quê, antes
  e depois) é registrada para rastreabilidade.
- **Multi-idioma** — interface em português, inglês e espanhol.
- **Perfis de acesso** — gestor, consulta (somente leitura), operador de PCP e
  administrador de TI, com controle de acesso reforçado no backend (o frontend só
  reflete a UX).
- **Integração bidirecional com ERP** — exemplo de sincronização com um ERP externo
  (produtos, vendas) e exportação dos resultados de volta, orquestrada por DAGs
  do Airflow.

## Stack

| Camada | Tecnologias |
|---|---|
| Frontend | React 19, Vite, TypeScript, Tailwind CSS v4, TanStack Query, react-router v7, react-i18next |
| Backend | Node.js, Express, TypeScript, Prisma ORM |
| Banco de dados | PostgreSQL 18 |
| Orquestração | Apache Airflow (DAGs em Python) — sincronização de ERP + motor de forecast |
| Infra | Docker / Docker Compose; Traefik como proxy reverso opcional em produção |

## Arquitetura em alto nível

```
frontend/   SPA React (servida por Nginx em produção)
backend/    API REST Node.js/Express + Prisma, porta 3000
dags/       DAGs do Airflow (sync de ERP + motor de forecast por IA), Python
```

- **Camadas do backend**: roteamento estrito `routes → controllers → services →
  Prisma`, um arquivo por domínio em cada pasta.
- **Modelo de domínio do forecast**: `ForecastRun` (uma execução, com janela de
  meses editável) → `ForecastItem` (uma linha por produto × unidade × mês,
  com o volume gerado pela IA) → `ForecastOverride` (o volume confirmado
  manualmente pelo gestor, com histórico de alterações).
- **Chaves de negócio como chave primária** — `Produto`, `UnidadeVenda`, `Pais` e
  `OrcamentoRun` usam seus identificadores de negócio (código, ISO3, ano) como PK
  em vez de UUIDs artificiais, simplificando integrações com sistemas externos.
- **Snapshots pré-computados** — tabelas de consolidado e acurácia são
  recalculadas em background e servidas pelos dashboards, em vez de agregar os
  dados brutos a cada requisição.
- **Integração com Airflow é bidirecional** — DAGs chamam endpoints internos do
  backend (autenticados por token estático, independente do JWT de usuário) e o
  backend também pode disparar execuções de DAG via API REST do Airflow.

## Como executar localmente

Requer Docker + Docker Compose. Não há hot-reload nos containers — cada mudança
de código exige rebuild da imagem; para iterar rápido, prefira rodar
frontend/backend localmente (segunda seção abaixo).

### 1. Configurar variáveis de ambiente

```bash
cp .env.example .env
```

Este repositório já inclui um `docker-compose.override.yml` que remove a
dependência de um proxy Traefik externo — é aplicado automaticamente pelo Docker
Compose e expõe a aplicação direto em `http://localhost:8080`. (O `docker-compose.yml`
principal mantém o roteamento via Traefik, usado em ambientes com domínio/HTTPS
reais; veja os comentários no arquivo se for adaptar para produção própria.)

Principais variáveis (veja todas comentadas em [.env.example](.env.example)):

| Variável | Descrição |
|---|---|
| `JWT_SECRET` | Chave de assinatura dos tokens — gere com `openssl rand -hex 64` |
| `INTERNAL_SYNC_TOKEN` | Autentica chamadas internas Airflow → Backend — gere com `openssl rand -hex 32` |
| `AIRFLOW_BASE_URL` / `AIRFLOW_USER` / `AIRFLOW_PASSWORD` | Integração com Airflow — o backend exige as 3 definidas no start, mas qualquer valor placeholder serve se você não for rodar Airflow |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` / `POSTGRES_PORT` | Credenciais e porta do PostgreSQL (porta padrão exposta no host: `5433`) |
| `ADMIN_INITIAL_EMAIL` / `ADMIN_INITIAL_PASSWORD` | Cria um usuário admin no primeiro start, se ainda não existir |

### 2. Subir os serviços

```bash
docker compose up -d --build
```

Isso builda e inicia PostgreSQL, backend e frontend. As migrations do Prisma são
aplicadas automaticamente no start do backend.

### 3. Popular o banco com dados fictícios

```bash
cd backend
npm install
npx prisma generate
npm run seed
```

O seed cria unidades, produtos, usuários e um histórico de forecast/vendas/
orçamento totalmente fictícios (12 meses de execuções de forecast, overrides,
submissões em diferentes estágios de aprovação e vendas históricas). Use
`npm run seed:force` para apagar e recriar os dados fictícios.

Login de exemplo criado pelo seed:

| Perfil | E-mail | Senha |
|---|---|---|
| Administrador (TI) | `admin@empresa.com` | `admin123` |
| Gestor | `joao.silva@empresa.com` | `gestor123` |
| Consulta | `ana.lima@empresa.com` | `controle123` |

Acesse em **http://localhost:8080**.

## Desenvolvimento local (sem Docker)

Útil para iterar rápido no código. Requer Node.js 18+ e um PostgreSQL acessível
(o do `docker compose up postgres` funciona). Scripts locais usam `backend/.env`
(separado do `.env` da raiz, lido apenas pelo Docker Compose).

### Backend

```bash
cd backend
npm install
cp .env.example .env        # ajuste DATABASE_URL se necessário
npx prisma migrate deploy   # aplica as migrations (use "migrate dev" para criar novas)
npm run seed                # popula dados fictícios
npm run dev                 # servidor com hot reload em http://localhost:3000
```

### Frontend

```bash
cd frontend
npm install
npm run dev                 # Vite em http://localhost:5173 (proxy /api e /uploads → :3000)
```

Comandos úteis adicionais (Prisma Studio, backfill, export de dados de seed entre
ambientes, etc.) estão documentados em [CLAUDE.md](CLAUDE.md).

## Perfis de acesso

| Perfil | Acesso |
|---|---|
| `gestor` | Submete o forecast da(s) unidade(s) de venda em que atua |
| `operador_pcp` | Aprova/rejeita submissões de todas as unidades; administra produtos, integrações e configuração de ciclo |
| `admin_ti` | Administração completa (usuários, unidades, configurações) |
| `consulta` | Somente leitura — Dashboard e Consolidado de todas as unidades, sem ações de mutação |

A autorização é sempre reforçada no backend — o frontend apenas oculta/redireciona
por conveniência de UX.

## Decisões técnicas relevantes

- **Resolução de forecast por janela sobreposta** — como múltiplas execuções de
  forecast podem cobrir o mesmo mês com janelas diferentes, "qual forecast vale
  para o mês X" não é uma simples busca pela execução mais recente: o sistema
  escolhe, para cada unidade/mês, a execução aprovada cuja janela cobre aquele mês
  com o maior mês de referência (desempate pela data de execução).
- **Trilha de auditoria desacoplada da lógica de negócio** — o registro de
  auditoria é escrito explicitamente pelos serviços que fazem a mutação, e não
  inferido depois a partir de triggers, para manter o "antes/depois" e o autor
  exatamente como a aplicação os conheceu no momento da mudança.
- **Autenticação dupla** — JWT de usuário (com papel e unidades embutidos no
  token) para as rotas usadas pela SPA, e um token estático comparado em tempo
  constante para as rotas internas chamadas pelo Airflow — os dois esquemas não
  se misturam.
- **Snapshots como cache de leitura, não como fonte de verdade** — as tabelas de
  consolidado/acurácia existem só para acelerar os dashboards; qualquer mutação
  nos dados de forecast, orçamento ou vendas precisa re-sincronizar os snapshots
  correspondentes.

## Estrutura do projeto

```
frontend/   React 19 + Vite (Tailwind v4, TanStack Query, react-router v7, i18next)
backend/    Express + Prisma REST API
dags/       DAGs do Airflow — não faz parte do build Node, roda em ambiente Python separado
```
