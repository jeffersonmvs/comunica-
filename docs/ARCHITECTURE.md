# Arquitetura — COMUNICA+

Este documento descreve a arquitetura do **MVP** entregue neste repositório e
como ela evolui para a **arquitetura-alvo** descrita no conceito.

## Princípios

O conceito define cinco prioridades inegociáveis. Elas guiam cada decisão:

1. **Velocidade** — comunicação instantânea, PTT com um toque.
2. **Confiabilidade** — a mensagem chega e é reproduzível.
3. **Registro** — nada é perdido: áudio + transcrição + metadados.
4. **Rastreabilidade** — quem falou, quando, para quem, com que prioridade.
5. **Responsabilidade** — cada transmissão é atribuída a um usuário/setor.

## Visão geral do MVP

```
┌────────────────────────── Navegador ──────────────────────────┐
│  public/index.html · styles.css · app.js                       │
│  • Painel Operacional (presença, canais, feed, ocorrências)    │
│  • Console PTT: SFU (mediasoup-client) / WebRTC P2P (fallback)  │
│    + MediaRecorder (gravação) + Web Speech API (transcrição)   │
│  • Socket.IO client (servido pelo backend, sem CDN externo)    │
└──────▲──────────────▲───────────────────────────▲─────────────┘
  voz ao vivo│  REST (JSON)│                WebSocket│(Socket.IO)
  (WebRTC:SFU│             │      + sinalização SFU/P2P│
   ou P2P)   │             │                          │
┌───────────┴─────────────┴──────────────────────────┴──────────┐
│                         Backend NestJS                         │
│                                                                │
│  Controllers ── UsersController, ChannelsController,           │
│                 TransmissionsController, OccurrencesController,│
│                 SearchController, AuthController               │
│  Gateway ────── PttGateway (presença, arbitragem, sinalização  │
│                 SFU/WebRTC, difusão de transmissões)           │
│  Serviços ───── AiService (stub) · AuthService (JWT+RBAC)      │
│                 SfuService (mediasoup: worker/routers/transports)│
│                 TransmissionsService (registro + IA + índice)  │
│                 OccurrencesService · SearchService (FTS5)      │
│  Infra ──────── DatabaseService (better-sqlite3 + FTS5)        │
│                 Áudio no sistema de arquivos (AUDIO_DIR)       │
└────────────────────────────────────────────────────────────────┘
```

## Modelo de dados

```
users(id, name, sector, role, password_hash, login, created_at)
channels(id, key, name, description, created_at)
transmissions(id, channel_id→channels, user_id→users, priority,
              started_at, duration_ms, audio_path, mime_type,
              transcript, summary, keywords(json), created_at)
occurrences(id, transmission_id→transmissions, category, sector, priority,
            title, summary, responsible, status, opened_at, updated_at,
            history(json))
receipts(id, transmission_id→transmissions, user_id→users, type, at)
transmissions_fts(transmission_id UNINDEXED, transcript, summary,
                  keywords, sector, channel)   -- FTS5
```

Cada **transmissão** é o registro permanente do conceito ("data, horário,
usuário, setor, destinatários, duração, áudio, transcrição, resumo da IA,
palavras-chave"). As tabelas foram desenhadas para migração direta ao
PostgreSQL.

## Fluxo de uma transmissão (PTT)

1. Usuário **segura o botão** → cliente emite `ptt_start {channelId, priority}`.
2. O `PttGateway` verifica ocupação do canal. **Emergência 🔴 pode interromper**
   uma transmissão de prioridade menor (modela a prioridade de rádio
   profissional); caso contrário, retorna `ptt_denied`.
3. `ptt_started` é difundido (com `speakerSocketId`). O falante abre o microfone
   **uma vez** e usa o mesmo `MediaStream` para dois destinos em paralelo:
   - **Voz ao vivo** — caminho preferencial é o **SFU (mediasoup)**: o falante
     publica **um** fluxo (`sfu_produce`); o servidor encaminha a cada ouvinte
     (`sfu_consume`). Se o SFU estiver indisponível, cai para a **malha P2P**
     (WebRTC direto entre navegadores). Latência típica **< 300 ms**.
   - **`MediaRecorder`** grava o clipe; a `Web Speech API` gera a transcrição.
4. Usuário **solta o botão** → encerra o fluxo ao vivo (fecha o Producer SFU /
   os pares P2P) e envia `ptt_end` com o áudio gravado (base64) + transcrição.
5. `TransmissionsService.create` executa o pipeline:
   - `AiService.analyze()` → normaliza transcrição, extrai palavras-chave,
     **classifica prioridade**, **gera resumo** e **detecta ocorrência**;
   - grava o áudio em `AUDIO_DIR`;
   - persiste a transmissão e **indexa no FTS5**;
   - se for intercorrência, **cria automaticamente uma ocorrência**.
6. `transmission_created` é difundido: o painel e o histórico atualizam. A voz
   já foi ouvida **ao vivo**; o clipe gravado fica disponível para reprodução.

### Voz ao vivo — SFU (mediasoup) com fallback P2P

**SFU (Selective Forwarding Unit), topologia em estrela — caminho preferencial.**
O `SfuService` mantém um **Worker** mediasoup e um **Router por canal** (codec
Opus). O fluxo de sinalização (via `PttGateway`):

1. `sfu_capabilities {channelId}` → `{ available, rtpCapabilities, producers }`.
   O cliente carrega um `mediasoup-client` **Device** com essas capacidades.
2. `sfu_create_transport` → o servidor cria um `WebRtcTransport` e devolve
   `iceParameters/iceCandidates/dtlsParameters`. `sfu_connect_transport` conclui
   o DTLS.
3. Falante: `sfu_produce {kind, rtpParameters}` cria um **Producer**; o servidor
   emite `sfu_new_producer` aos ouvintes do canal.
4. Ouvinte: `sfu_consume {producerId, rtpCapabilities}` cria um **Consumer**
   (pausado) e `sfu_resume` inicia o áudio. *Late-join* consome os producers já
   ativos (retornados em `sfu_capabilities.producers`).
5. Em `ptt_end`/`ptt_cancel`/desconexão, o Producer é fechado — os Consumers
   recebem `producerclose` e param.

Vantagem sobre a malha: o falante envia **um** fluxo (não N conexões), então a
carga não cresce com o número de ouvintes — escala para o canal inteiro.

**Fallback malha P2P.** Se o worker do mediasoup não iniciar (`available=false`),
o cliente usa WebRTC **direto entre navegadores**: o `PttGateway` só encaminha
`webrtc_join/offer/answer/ice` (cada evento leva `to` = destino; reenvia com
`from` = remetente). STUN público para candidatos ICE; em `localhost`/LAN,
candidatos host bastam.

> **Verificação:** sinalização, criação de transports (ICE/DTLS), router/codec e
> o *plumbing* de produce/consume são cobertos por testes automatizados. O
> **encaminhamento real de mídia** (RTP Opus falante→servidor→ouvinte) exige
> navegadores reais e é validado manualmente (duas abas, mesmo canal).

## Camada de IA (ponto de extensão)

No MVP, `AiService` é um **stub determinístico** (sem chave de API, roda
offline). Ele cumpre os quatro papéis do conceito com regras em PT-BR:

| Papel | Stub (hoje) | Produto (futuro) |
| --- | --- | --- |
| Transcrição | Web Speech API (cliente) + normalização | Whisper com diarização de locutores |
| Palavras-chave | frequência + stopwords PT-BR | embeddings |
| Prioridade | triagem por termos (nunca rebaixa a escolha do humano) | classificador LLM |
| Resumo | frases de maior densidade de palavras-chave | sumarização LLM |
| Busca | FTS5 (BM25) | banco vetorial (busca semântica) |
| Ocorrência | gatilhos de intercorrência + categorização por setor | extração estruturada por LLM |

A interface `analyze(transcript, sector, priority): AiAnalysis` é o único ponto
a trocar para adotar Whisper + LLM, sem alterar controllers, gateway ou banco.

## Livro de Ocorrências Inteligente

Toda transmissão que contém um gatilho de intercorrência (equipamento parado,
falta de insumo, suspensão, evacuação, etc.) vira automaticamente uma
**ocorrência estruturada**: categoria (por setor + palavras-chave), prioridade,
responsável informado (detectado no texto), resumo, e status com histórico
(**Aberto → Em andamento → Resolvido**). Isso cria um histórico institucional
pesquisável e auditável **sem formulários** — os coordenadores apenas falam.

## Autenticação e autorização (RBAC)

- **Login + senha:** senhas são guardadas com **scrypt** (nativo do Node, sem
  dependência externa), no formato `salt:hash`. `POST /api/auth/register` e
  `POST /api/auth/login` retornam um **JWT** assinado (`JWT_SECRET`, validade
  `JWT_EXPIRES_IN`).
- **Guarda global (`JwtAuthGuard`):** todas as rotas exigem `Authorization:
  Bearer <token>`, exceto as marcadas com `@Public()` (registro, login, listas
  de setores/papéis). O usuário autenticado é injetado em `req.user`.
- **RBAC (`RolesGuard` + `@Roles()`):** papéis têm hierarquia
  (`Operador < Coordenador < Direção < Admin`). `@Roles(Role.COORDENADOR)`
  libera coordenador **e acima**. Exemplos aplicados: alterar status de
  ocorrência exige *Coordenador+*; listar usuários exige *Direção+*.
- **WebSocket autenticado:** o token vai no handshake (`auth: { token }`); o
  `PttGateway` valida na conexão e **vincula a identidade ao socket** — o
  `identify` usa essa identidade, não confia em `userId` do cliente (evita
  spoofing de "quem falou").
- **Papel × setor:** o *setor* diz de onde a pessoa fala; o *papel* diz o que
  ela pode fazer. No cadastro, o papel é sugerido a partir do setor
  (`defaultRoleForSector`).

## Do MVP ao produto — mapeamento

| Camada | MVP | Arquitetura-alvo (conceito) |
| --- | --- | --- |
| App | Web app (HTML/JS) | Flutter |
| Backend | NestJS | NestJS ou Go |
| PTT / voz ao vivo | **SFU mediasoup** (estrela, < 300 ms) + fallback P2P + gravação | SFU em cluster + gravação server-side |
| Mensageria | eventos Socket.IO | NATS ou MQTT |
| Banco principal | SQLite | PostgreSQL |
| Cache/presença | memória do processo | Redis |
| Áudio | sistema de arquivos | storage compatível com S3 |
| Transcrição | Web Speech API + stub | Whisper + diarização |
| IA (resumo/prioridade) | regras determinísticas | LLM |
| Busca | FTS5 | banco vetorial (semântica) |
| Autenticação | **login+senha (scrypt) + JWT** | + IdP/SSO, refresh tokens |
| Autorização | **RBAC por papel** | RBAC + políticas finas |
| Criptografia | JWT + TLS em trânsito | ponta a ponta |

## Roadmap

- [x] **Streaming de voz em tempo real com WebRTC (latência < 300 ms)** — malha P2P.
- [x] **SFU (mediasoup)** para voz ao vivo em estrela — escala por canal;
      malha P2P mantida como fallback automático.
- [ ] SFU em **cluster** (pool de workers/roteadores, múltiplas instâncias),
      gravação server-side a partir do SFU e verificação de mídia automatizada
      (headless com RTP sintético).
- [ ] Substituir stub de transcrição por Whisper com diarização de locutores.
- [ ] Resumo/classificação/pesquisa semântica via LLM + banco vetorial.
- [ ] Presença e arbitragem de canal em Redis (escala horizontal).
- [ ] Migrar persistência para PostgreSQL e áudio para storage S3.
- [x] **Autenticação (login+senha, JWT) e autorização por papel (RBAC).**
- [ ] Federação de identidade (IdP/SSO) e criptografia ponta a ponta.
- [ ] App Flutter (segundo plano, mãos-livres, notificações críticas).
- [ ] Exportação de registros para auditorias e investigações.

## Decisões e limitações do MVP

- **SQLite síncrono (better-sqlite3):** simplicidade e zero infraestrutura;
  adequado para demonstração, não para produção multi-instância.
- **Presença em memória:** reinícios limpam a presença; o registro histórico
  (transmissões/ocorrências) é persistido e preservado.
- **Voz ao vivo via SFU (mediasoup), 1 worker/router por canal:** ótimo para o
  MVP; produção com muitos canais/instâncias pede pool de workers e cluster.
  Fallback P2P (malha) cobre ambientes sem o worker nativo.
- **SFU exige rede:** fora de `localhost`, defina `SFU_ANNOUNCED_IP` (IP público)
  e libere a faixa UDP `SFU_MIN_PORT`–`SFU_MAX_PORT`.
- **A gravação (registro permanente) trafega em base64 no `ptt_end`** (limite de
  25 MB no corpo) — separada do caminho ao vivo. No produto, a própria captura
  do SFU pode alimentar a gravação.
- **WebRTC exige contexto seguro:** funciona em `localhost` (demo) ou HTTPS.
- **Mídia real do SFU não é testada em headless:** signaling/transports/produce/
  consume têm cobertura automatizada; o RTP fim-a-fim é validado em navegador.
- **Autenticação por login+senha (JWT) e RBAC** já implementados. Evoluções de
  produção: IdP/SSO, rotação de segredo, refresh tokens e criptografia ponta a
  ponta.
