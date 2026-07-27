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
│  • Console PTT: MediaRecorder (áudio) + Web Speech API (texto)  │
│  • Socket.IO client (servido pelo backend, sem CDN externo)    │
└───────────────▲───────────────────────────────▲───────────────┘
      REST (JSON)│                       WebSocket│(Socket.IO)
┌───────────────┴───────────────────────────────┴───────────────┐
│                         Backend NestJS                         │
│                                                                │
│  Controllers ── UsersController, ChannelsController,           │
│                 TransmissionsController, OccurrencesController,│
│                 SearchController                               │
│  Gateway ────── PttGateway (presença, arbitragem de canal por  │
│                 prioridade, difusão de transmissões)           │
│  Serviços ───── AiService (stub determinístico)                │
│                 TransmissionsService (registro + IA + índice)  │
│                 OccurrencesService (Livro de Ocorrências)      │
│                 SearchService (FTS5)                           │
│  Infra ──────── DatabaseService (better-sqlite3 + FTS5)        │
│                 Áudio no sistema de arquivos (AUDIO_DIR)       │
└────────────────────────────────────────────────────────────────┘
```

## Modelo de dados

```
users(id, name, sector, created_at)
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
3. Enquanto fala: `MediaRecorder` grava o áudio e a `Web Speech API` gera a
   transcrição ao vivo. `ptt_started` é difundido (painel mostra "no ar").
4. Usuário **solta o botão** → cliente envia `ptt_end` com áudio (base64) +
   transcrição.
5. `TransmissionsService.create` executa o pipeline:
   - `AiService.analyze()` → normaliza transcrição, extrai palavras-chave,
     **classifica prioridade**, **gera resumo** e **detecta ocorrência**;
   - grava o áudio em `AUDIO_DIR`;
   - persiste a transmissão e **indexa no FTS5**;
   - se for intercorrência, **cria automaticamente uma ocorrência**.
6. `transmission_created` é difundido: o painel atualiza e os ouvintes do canal
   **reproduzem o áudio** automaticamente.

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

## Do MVP ao produto — mapeamento

| Camada | MVP | Arquitetura-alvo (conceito) |
| --- | --- | --- |
| App | Web app (HTML/JS) | Flutter |
| Backend | NestJS | NestJS ou Go |
| PTT / mídia | clipe via WebSocket + auto-play | WebRTC (streaming, < 300 ms) |
| Mensageria | eventos Socket.IO | NATS ou MQTT |
| Banco principal | SQLite | PostgreSQL |
| Cache/presença | memória do processo | Redis |
| Áudio | sistema de arquivos | storage compatível com S3 |
| Transcrição | Web Speech API + stub | Whisper + diarização |
| IA (resumo/prioridade) | regras determinísticas | LLM |
| Busca | FTS5 | banco vetorial (semântica) |
| Criptografia | — (TLS em trânsito) | ponta a ponta |

## Roadmap

- [ ] Substituir stub de transcrição por Whisper com diarização de locutores.
- [ ] Resumo/classificação/pesquisa semântica via LLM + banco vetorial.
- [ ] Streaming de voz em tempo real com WebRTC (latência < 300 ms).
- [ ] Presença e arbitragem de canal em Redis (escala horizontal).
- [ ] Migrar persistência para PostgreSQL e áudio para storage S3.
- [ ] Autenticação/autorização (papéis) e criptografia ponta a ponta.
- [ ] App Flutter (segundo plano, mãos-livres, notificações críticas).
- [ ] Exportação de registros para auditorias e investigações.

## Decisões e limitações do MVP

- **SQLite síncrono (better-sqlite3):** simplicidade e zero infraestrutura;
  adequado para demonstração, não para produção multi-instância.
- **Presença em memória:** reinícios limpam a presença; o registro histórico
  (transmissões/ocorrências) é persistido e preservado.
- **Áudio trafega em base64 no `ptt_end`** (limite de 25 MB no corpo). No
  produto, o transporte é WebRTC com streaming contínuo.
- **Sem autenticação forte:** a identificação é por nome+setor, suficiente para
  o MVP; produção exige IdP e RBAC.
