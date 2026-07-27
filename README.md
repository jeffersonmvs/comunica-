# COMUNICA+ 📻

> Plataforma de comunicação operacional hospitalar baseada em **Push-to-Talk (PTT)** — inspirada em rádios profissionais, porém digital, com **registro permanente, transcrição, resumo por IA e busca inteligente** de cada comunicação.

Cada comunicação é um **evento operacional** e permanece registrada para auditoria. A prioridade do sistema é **velocidade, confiabilidade, registro, rastreabilidade e responsabilidade**.

Este repositório contém um **MVP funcional e executável** da plataforma: um backend NestJS + uma web app de operação. Roda com **zero infraestrutura externa** (SQLite + sistema de arquivos), e a camada de IA é um **stub determinístico local** com interfaces prontas para plugar Whisper/LLM reais.

---

## O que já funciona (MVP)

| Recurso do conceito | Status neste MVP |
| --- | --- |
| Push-to-Talk com um toque (segurar para falar) | ✅ Web app (pointer + barra de espaço) |
| Comunicação por canais (Diretoria, CC, UTI, …) | ✅ 9 canais padrão |
| Prioridades 🟢🟡🟠🔴 estilo rádio | ✅ Emergência interrompe transmissão não crítica |
| Presença em tempo real / "quem está no ar" | ✅ via WebSocket |
| Transcrição em tempo real | ✅ Web Speech API do navegador |
| Registro permanente (áudio + transcrição + metadados) | ✅ SQLite + arquivos |
| Resumo automático por IA | ✅ stub determinístico (bullets) |
| Classificação de prioridade por IA | ✅ triagem por regras |
| Busca inteligente (palavra ou pergunta) | ✅ FTS5 |
| **Livro de Ocorrências Inteligente** | ✅ ocorrência estruturada automática + ciclo Aberto→Em andamento→Resolvido |
| Confirmação de recebimento / escuta | ✅ |
| Painel operacional (online, canais, últimas transmissões, ocorrências) | ✅ |
| Reprodução das transmissões | ✅ |

Itens do conceito ainda **não** implementados neste MVP (ver [roadmap](docs/ARCHITECTURE.md#roadmap)): app Flutter nativo, streaming de mídia via WebRTC, diarização real de locutores, criptografia ponta a ponta, NATS/MQTT, PostgreSQL + banco vetorial, funcionamento em segundo plano/mãos-livres.

---

## Arquitetura do MVP

```
Navegador (web app)                         Backend NestJS
┌───────────────────────────┐   REST/WS    ┌──────────────────────────────┐
│  Painel Operacional        │◀────────────▶│  Controllers (users/channels/│
│  Console PTT (MediaRecorder│              │   transmissions/occurrences/ │
│   + Web Speech API)        │              │   search)                    │
│  Socket.IO client          │              │  PttGateway (Socket.IO)      │
└───────────────────────────┘              │  AiService (stub → Whisper/  │
                                            │   LLM no futuro)             │
                                            │  DatabaseService (SQLite/FTS5│
                                            │   → PostgreSQL + vetorial)   │
                                            └──────────────────────────────┘
```

A escolha de stack segue a **arquitetura sugerida** no conceito (Backend NestJS). SQLite/FTS5 e o sistema de arquivos substituem, no MVP, o PostgreSQL + banco vetorial + storage S3 do produto final, mantendo o mesmo contrato de serviços. Detalhes em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Como executar

Pré-requisitos: **Node.js ≥ 18**.

```bash
# 1. Instalar dependências
npm install

# 2. Compilar
npm run build

# 3. Popular canais + um usuário demo por setor (opcional)
npm run seed

# 4. Subir o servidor
npm start
# COMUNICA+ no ar em http://localhost:3000
```

Abra **http://localhost:3000**, informe seu nome e setor, selecione um canal e **segure o botão para falar** (ou a barra de espaço). Para testar em "grupo", abra a URL em duas abas/navegadores com usuários diferentes.

> 💡 A transcrição ao vivo usa a Web Speech API (melhor no Chrome). Sem microfone? Use o campo **"Sem microfone? Enviar como texto"** — o pipeline de IA, registro e Livro de Ocorrências funciona igualmente.

### Desenvolvimento (hot reload)

```bash
npm run seed:dev   # popular usando ts-node
npm run start:dev  # ts-node-dev com respawn
```

### Testes

```bash
npm run smoke   # valida o pipeline central (IA, busca FTS, ocorrência automática)
```

---

## Variáveis de ambiente

Copie `.env.example` para `.env`. Padrões sensatos já funcionam sem configuração:

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `3000` | Porta HTTP/WebSocket |
| `DATABASE_PATH` | `./data/comunica.db` | Arquivo SQLite |
| `AUDIO_DIR` | `./data/audio` | Diretório dos áudios (→ bucket S3 no futuro) |

---

## API (resumo)

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/api/users/sectors` | Setores/funções disponíveis |
| `POST` | `/api/users` | Cria/identifica usuário |
| `GET` | `/api/channels` | Lista canais |
| `GET` | `/api/transmissions?channelId=&limit=` | Histórico de transmissões |
| `GET` | `/api/transmissions/:id/audio` | Reproduz áudio original |
| `POST` | `/api/transmissions/:id/receipts` | Confirma recebimento/escuta |
| `GET` | `/api/transmissions/stats` | Estatísticas do painel |
| `GET` | `/api/search?q=` | Busca inteligente (palavra ou pergunta) |
| `GET` | `/api/occurrences` | Livro de Ocorrências |
| `PATCH` | `/api/occurrences/:id/status` | Avança status da ocorrência |

**WebSocket (Socket.IO):** `identify`, `join_channel`, `ptt_start`, `ptt_end`, `ptt_cancel` →
eventos `presence`, `ptt_started`, `ptt_ended`, `ptt_interrupted`, `transmission_created`.

---

## Estrutura

```
src/
  common/        enums e tipos do domínio (setores, prioridades, status)
  database/      conexão SQLite + esquema (FTS5)
  ai/            camada de IA (stub determinístico: transcrição/resumo/prioridade/ocorrência)
  users/         usuários e setores
  channels/      canais de rádio
  transmissions/ registro permanente (áudio + IA + índice de busca)
  occurrences/   Livro de Ocorrências Inteligente
  search/        busca inteligente sobre FTS5
  realtime/      gateway PTT (presença, arbitragem de canal, difusão)
public/          web app (painel + console PTT)
scripts/         smoke test do pipeline
docs/            arquitetura e roadmap
```

## Licença

MIT.
