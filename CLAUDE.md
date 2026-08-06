# CLAUDE.md

Guia para assistentes de IA que trabalham neste repositório. Cobre estrutura,
comandos verificados, convenções e as armadilhas do projeto.

> **Idioma:** todo o projeto é em **português (PT-BR)** — comentários, JSDoc,
> mensagens de erro, rótulos de UI, docs e mensagens de commit. Mantenha esse
> padrão em qualquer código novo. Identificadores (classes, métodos, variáveis)
> ficam em inglês, exceto os termos de domínio, que seguem o vocabulário
> operacional em PT-BR (`Sector`, `Priority.EMERGENCIA`, `OccurrenceStatus`…).

---

## O que é o projeto

**COMUNICA+** — plataforma de comunicação operacional hospitalar **Push-to-Talk
(PTT)**: rádio profissional digital com **registro permanente** de cada
transmissão (áudio + transcrição + resumo por IA + palavras-chave), **Livro de
Ocorrências Inteligente** e busca full-text.

É um **MVP funcional e executável**, não um esqueleto: backend NestJS +
web app sem framework, rodando com **zero infraestrutura externa** (SQLite +
sistema de arquivos). A camada de IA é um **stub determinístico local** com a
interface pronta para plugar Whisper/LLM reais.

Cinco prioridades inegociáveis guiam cada decisão de design (ver
`docs/ARCHITECTURE.md`): **velocidade, confiabilidade, registro,
rastreabilidade, responsabilidade**.

---

## Stack

| Camada | Tecnologia |
| --- | --- |
| Backend | NestJS 10 (CommonJS, decorators), Node **≥ 22** |
| Tempo real | Socket.IO (`@nestjs/websockets` + `@nestjs/platform-socket.io`) |
| Voz ao vivo | **mediasoup** (SFU, dependência **opcional**) com fallback **WebRTC P2P** |
| Persistência | `better-sqlite3` (síncrono) + **FTS5** para busca |
| Autenticação | `@nestjs/jwt` + scrypt nativo (`node:crypto`) |
| Frontend | HTML/CSS/JS puro em `public/` — **sem framework, sem CDN externo** |
| Build | `tsc` + `esbuild` (bundle do `mediasoup-client`) |

Não há framework de teste (Jest/Vitest), linter nem formatter configurados.
A verificação automatizada é o **smoke test** em `scripts/smoke-test.js`.

---

## Comandos

```bash
npm ci                 # instala tudo (inclui mediasoup — compila/baixa worker nativo)
npm ci --omit=optional # instala sem mediasoup → SFU off, voz ao vivo via P2P

npm run build          # esbuild (public/vendor/…) + tsc -p tsconfig.build.json → dist/
npm run build:client   # só o bundle do mediasoup-client
npm run seed           # popula canais + usuários demo (exige build)
npm start              # node dist/main.js  → http://localhost:3000
npm run start:prod     # seed + start (usado no container)

npm run start:dev      # ts-node-dev --respawn (hot reload, sem build)
npm run seed:dev       # seed via ts-node

npm run smoke          # smoke test do pipeline central (EXIGE npm run build antes)
```

**O smoke test roda sobre `dist/`, não sobre `src/`.** Sempre
`npm run build && npm run smoke` depois de mexer no backend — sem o build você
testa código antigo.

### Verificação antes de commitar

Não há CI de testes; a validação mínima esperada é:

```bash
npm run build && npm run smoke
```

Estado verificado nesta base (Node 22, Linux):
- `npm run build` → OK.
- `npm run smoke` com `mediasoup` instalado → **passa integralmente** (seções 0–6).
- `npm run smoke` **sem** `mediasoup` (`npm ci --omit=optional`) → seções 0–5
  passam; a **seção [6] (SFU) falha** com `Erro no smoke test: SFU indisponível`.
  Isso é esperado, não é regressão — a seção [6] assume o worker nativo presente.
  Para rodar o smoke completo, garanta `mediasoup` instalado.

Credenciais demo criadas pelo seed: login = **chave do setor**
(`centro_cirurgico`, `uti`, `diretoria`, `emergencia`…) ou **`admin`**;
senha = **`1234`**.

---

## Estrutura

```
src/
  main.ts             bootstrap (CORS, body 25 MB p/ áudio base64, static /public, bind 0.0.0.0)
  app.module.ts       raiz; registra JwtAuthGuard e RolesGuard como APP_GUARD (nesta ordem)
  seed.ts             canais padrão + 1 usuário demo por setor + admin
  common/             enums do domínio, tipos, hash de senha (scrypt)
  database/           DatabaseService (SQLite/WAL) + SCHEMA_SQL (inclui FTS5) + migrações
  ai/                 AiService — stub determinístico (transcrição/keywords/prioridade/resumo/ocorrência)
  auth/               JWT + RBAC (guards, @Public, @Roles, @CurrentUser)
  users/              usuários, setores, papéis
  channels/           canais de rádio (seed idempotente no onModuleInit)
  transmissions/      registro permanente: áudio → IA → SQLite → FTS5 → ocorrência
  occurrences/        Livro de Ocorrências Inteligente
  search/             busca inteligente sobre FTS5 (bm25)
  sfu/                SfuService — mediasoup (worker, router por canal, transports)
  realtime/           PttGateway — presença, arbitragem de canal, sinalização SFU/P2P, difusão
public/               web app (index.html, app.js, styles.css) + vendor/ (gerado)
scripts/smoke-test.js smoke test do pipeline (roda sobre dist/)
docs/ARCHITECTURE.md  arquitetura, modelo de dados, roadmap, limitações
DEPLOY.md             publicação no Render (Docker)
```

Artefatos **não versionados** (`.gitignore`): `dist/`, `node_modules/`,
`data/` (SQLite + áudios), `public/vendor/` (bundle gerado), `.env`.

---

## Convenções do código

### Módulos NestJS
- Um diretório por domínio com `*.module.ts` / `*.service.ts` / `*.controller.ts`.
- Serviços transversais são `@Global()`: `DatabaseModule`, `AiModule`,
  `AuthModule`, `SfuModule`. Os demais exportam explicitamente o service.
- Seeds idempotentes ficam no `onModuleInit` do módulo (ex.: `ChannelsModule`).
- `DatabaseService` abre o banco e cria o esquema **no construtor**, de
  propósito: garante o banco pronto antes de qualquer `onModuleInit`.

### Rotas e prefixos
- Todos os controllers usam o prefixo literal `api/…` no `@Controller` (não há
  `setGlobalPrefix`). `/` serve a web app estática de `public/`.
- **Toda rota exige `Authorization: Bearer <token>`** por causa do `JwtAuthGuard`
  global. Rotas públicas precisam de `@Public()` explícito (registro, login,
  listas de setores/papéis).
- RBAC hierárquico: `@Roles(Role.COORDENADOR)` libera coordenador **e acima**,
  via `ROLE_RANK` (`operador < coordenador < diretor < admin`).
- Ao criar rota nova, decida conscientemente: pública, autenticada ou com papel
  mínimo — o default é "autenticada".

### Acesso a dados
- SQL escrito à mão com `better-sqlite3` (**síncrono**, sem `await`), sempre
  com *prepared statements* e parâmetros `?`. Não há ORM — não introduza um.
- Colunas em `snake_case`; API/tipos em `camelCase`. Cada service tem uma
  `interface XRow` privada e um mapeador `toX(row)` — siga esse padrão.
- Campos de lista/objeto são guardados como **JSON em TEXT** (`keywords`,
  `history`) e desserializados no mapeador.
- Timestamps são **strings ISO-8601** (`new Date().toISOString()`), nunca
  `Date` nem epoch.
- IDs são **UUID v4** (`uuid`), gerados na aplicação.
- Mudanças de esquema: adicione o `CREATE TABLE` novo em `schema.ts` **e** uma
  migração idempotente em `DatabaseService.migrate()` (padrão atual: checar
  `PRAGMA table_info` e `ALTER TABLE ADD COLUMN`), para não quebrar bancos
  existentes.
- Escreveu em `transmissions`? Indexe também em `transmissions_fts` — a busca
  depende disso (ver `TransmissionsService.create`).

### Erros e validação
- Validação manual nos services com exceções do Nest
  (`BadRequestException`, `NotFoundException`, `UnauthorizedException`,
  `ForbiddenException`), com mensagem **em PT-BR e voltada ao operador**.
  Não há `class-validator`/`ValidationPipe`.
- Type guards de enum ficam em `common/enums.ts` (`isSector`, `isRole`,
  `isPriority`) — use-os em vez de casts soltos.
- Handlers do WebSocket **não lançam**: retornam `{ ok: false, error: '…' }`
  (ou `{ ok: true, … }`) como ACK. Mantenha esse contrato.

### Frontend (`public/app.js`)
- Arquivo único, IIFE com `'use strict'`, sem build e sem dependências
  externas: `socket.io.js` é servido pelo próprio backend e o
  `mediasoup-client` vem do bundle local em `/vendor/`. **Não adicione CDN.**
- Estado centralizado no objeto `state`; sessão (`comunica_token`,
  `comunica_user`) em `localStorage`.
- Helpers padronizados: `$`, `el`, `esc` (escape de HTML — use sempre ao
  injetar dados do servidor), `fmtTime`, `api()`, `emitAck()`.

---

## Fluxos que importam

### Transmissão PTT (ponta a ponta)
1. Cliente segura o botão → `ptt_start {channelId, priority}`.
2. `PttGateway` arbitra o canal: **só `Priority.EMERGENCIA` interrompe** uma
   transmissão em curso de prioridade menor; caso contrário retorna
   `{ ok:false, denied:true }`.
3. O mesmo `MediaStream` alimenta dois caminhos em paralelo: **voz ao vivo**
   (SFU → fallback P2P) e **gravação** (`MediaRecorder` + Web Speech API).
4. Soltar o botão → `ptt_end` com áudio **base64** + transcrição.
5. `TransmissionsService.create` executa o pipeline:
   `AiService.analyze()` → grava o áudio em `AUDIO_DIR` → persiste →
   indexa no FTS5 → cria ocorrência automática se for intercorrência.
6. `transmission_created` é difundido para todos os clientes.

### Camada de IA — o ponto de extensão
`AiService.analyze(transcript, sector, priority): AiAnalysis` é a **única**
interface a trocar para adotar Whisper/LLM reais. Controllers, gateway e banco
não mudam. Regra invariável: **a IA nunca rebaixa a prioridade escolhida pelo
humano** (`classifyPriority` devolve a mais crítica entre as duas).

### Segurança do gateway
`PttGateway.handleConnection` valida o JWT do handshake (`auth: { token }`) e
grava a identidade em `client.data.userId`. O handler `identify` usa **essa**
identidade e **ignora qualquer `userId` enviado pelo cliente** — é o que impede
spoofing de "quem falou". Não introduza caminhos que confiem em identidade
vinda do payload do cliente.

---

## Armadilhas conhecidas

- **`mediasoup` é `optionalDependency`.** É carregado por `import()` dinâmico
  com especificador indireto (`const moduleName = 'mediasoup'`) justamente para
  o `tsc` não exigir o pacote e o build enxuto funcionar sem ele. **Não
  converta para `import` estático** e **não referencie tipos do mediasoup** —
  o `SfuService` usa `any` de propósito.
- `SFU_ENABLED=false` desliga o SFU explicitamente (ambientes sem UDP, como o
  Render). Sem o worker, `available=false` e o cliente cai sozinho para P2P.
- Fora de `localhost`, o SFU precisa de `SFU_ANNOUNCED_IP` (IP público) e da
  faixa UDP `SFU_MIN_PORT`–`SFU_MAX_PORT` liberada.
- **WebRTC e microfone exigem contexto seguro:** só funcionam em
  `http://localhost` ou sob HTTPS.
- O áudio do registro permanente trafega em **base64 dentro do `ptt_end`** —
  daí o limite de `25mb` no body parser em `main.ts`. Aumentar a duração das
  transmissões pode esbarrar nisso.
- **Presença é in-memory** (`Map` no gateway): reiniciar o processo zera a
  presença e impede escala horizontal. O registro histórico continua no banco.
- SQLite síncrono: adequado ao MVP, inadequado a múltiplas instâncias.
- No plano free do Render o **disco é efêmero** — banco e áudios somem a cada
  deploy; por isso o container roda `start:prod` (seed + start).
- A transcrição ao vivo usa a **Web Speech API** (funciona melhor no Chrome).
  Sem microfone, a UI oferece envio por texto — o pipeline de IA/registro/
  ocorrências é idêntico.
- Mídia RTP real do SFU **não** é coberta por teste automatizado; o smoke cobre
  signaling, router/codec e transports. Validação fim-a-fim é manual: duas
  abas, mesmo canal.

---

## Variáveis de ambiente

Copie `.env.example` para `.env`. Os padrões funcionam sem configuração.

| Variável | Padrão | Observação |
| --- | --- | --- |
| `PORT` | `3000` | O Render injeta automaticamente |
| `DATABASE_PATH` | `./data/comunica.db` | |
| `AUDIO_DIR` | `./data/audio` | → bucket S3 no produto final |
| `JWT_SECRET` | valor de dev | **defina em produção** |
| `JWT_EXPIRES_IN` | `12h` | |
| `SFU_ENABLED` | (ligado) | `false` desliga o SFU → P2P |
| `SFU_LISTEN_IP` | `127.0.0.1` | |
| `SFU_ANNOUNCED_IP` | — | obrigatório fora de `localhost` |
| `SFU_MIN_PORT` / `SFU_MAX_PORT` | `40000` / `40100` | faixa UDP |

O smoke test isola o ambiente sobrescrevendo `DATABASE_PATH`/`AUDIO_DIR` para
um diretório temporário — não toque no `data/` da máquina.

---

## Deploy

`Dockerfile` multi-stage (Node 22) + `render.yaml` (Blueprint). Por padrão a
imagem constrói com `npm ci --omit=optional` (**sem** compilar o worker nativo)
→ build rápido e voz ao vivo por P2P. Para uma imagem com SFU real
(Fly.io/VPS, onde há UDP):

```bash
docker build --build-arg WITH_SFU=1 -t comunica-plus:sfu .
```

Detalhes e primeiro acesso em `DEPLOY.md`.

---

## Fluxo de trabalho

- **Branch:** desenvolva na branch designada pela tarefa; nunca faça push
  direto na `main`.
- **Commits:** *Conventional Commits* em PT-BR
  (`feat:`, `fix(deploy):`, `chore:`), com corpo explicando **o problema e a
  raiz resolvida**, não só o que mudou — siga o estilo do histórico.
- **Documentação:** mudanças relevantes de arquitetura/roadmap/limitações vão
  para `docs/ARCHITECTURE.md`; mudanças de uso, API ou variáveis de ambiente
  vão para o `README.md` (que mantém tabelas de rotas e de env vars).
  Mantenha `.env.example` sincronizado ao adicionar configuração nova.
- **Antes de abrir PR:** `npm run build && npm run smoke`. Ao mexer no pipeline
  central (IA, busca, ocorrências, SFU), acrescente asserções ao
  `scripts/smoke-test.js` — é a única rede de segurança automatizada do repo.
