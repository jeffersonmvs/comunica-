# COMUNICA+ 📻

> Plataforma de comunicação operacional hospitalar baseada em **Push-to-Talk (PTT)** — inspirada em rádios profissionais, porém digital, com **registro permanente, transcrição, resumo por IA e busca inteligente** de cada comunicação.

Cada comunicação é um **evento operacional** e permanece registrada para auditoria. A prioridade do sistema é **velocidade, confiabilidade, registro, rastreabilidade e responsabilidade**.

Este repositório contém um **MVP funcional e executável** da plataforma: um backend NestJS + uma web app de operação. Roda com **zero infraestrutura externa** (SQLite + sistema de arquivos), e a camada de IA é um **stub determinístico local** com interfaces prontas para plugar Whisper/LLM reais.

---

## O que já funciona (MVP)

| Recurso do conceito | Status neste MVP |
| --- | --- |
| Push-to-Talk com um toque (segurar para falar) | ✅ Web app (pointer + barra de espaço) |
| **Voz ao vivo em tempo real (< 300 ms)** | ✅ WebRTC (malha P2P, sinalização via Socket.IO) |
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
| **Autenticação (login + senha, JWT)** | ✅ REST e WebSocket protegidos |
| **Controle de acesso por papel (RBAC)** | ✅ Admin / Direção / Coordenador / Operador |

A **voz ao vivo** usa WebRTC em **malha P2P** (cada falante conecta-se diretamente aos ouvintes do canal; o servidor só faz a sinalização). A mídia trafega direto entre navegadores, com latência típica **< 300 ms** — atendendo à meta do conceito. Em paralelo, o áudio é gravado e enviado ao final para o **registro permanente** + IA: *nada é perdido*. Malha P2P atende grupos pequenos; para escala, o próximo passo é um SFU (ex.: mediasoup) — ver [roadmap](docs/ARCHITECTURE.md#roadmap).

Itens do conceito ainda **não** implementados neste MVP (ver [roadmap](docs/ARCHITECTURE.md#roadmap)): app Flutter nativo, SFU para escala, diarização real de locutores, criptografia ponta a ponta, NATS/MQTT, PostgreSQL + banco vetorial, funcionamento em segundo plano/mãos-livres.

> ⚠️ WebRTC/microfone exigem **contexto seguro**: funciona em `http://localhost` (demo) ou sob **HTTPS** em produção. Para ouvir a voz ao vivo, abra duas abas/dispositivos, entre no **mesmo canal** e segure para falar em um deles.

---

## Arquitetura do MVP

```
Navegador (falante) ◀═══ WebRTC (voz ao vivo, P2P) ═══▶ Navegador (ouvinte)
        ▲                                                        ▲
        │ sinalização + REST/WS                                 │
Navegador (web app)                         Backend NestJS
┌───────────────────────────┐   REST/WS    ┌──────────────────────────────┐
│  Painel Operacional        │◀────────────▶│  Controllers (users/channels/│
│  Console PTT (WebRTC +     │              │   transmissions/occurrences/ │
│   MediaRecorder + Web      │              │   search)                    │
│   Speech API)              │              │  PttGateway (Socket.IO +     │
│  Socket.IO client          │              │   signaling WebRTC)          │
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

Abra **http://localhost:3000** e **entre** com uma credencial demo (aba **Entrar**) ou **cadastre-se** (aba **Cadastrar**). Selecione um canal e **segure o botão para falar** (ou a barra de espaço). Para testar em "grupo"/voz ao vivo, abra a URL em duas abas/navegadores com usuários diferentes, no **mesmo canal**.

> 🔐 **Credenciais demo** (criadas pelo `npm run seed`): login = **chave do setor** (ex.: `centro_cirurgico`, `uti`, `diretoria`… ) ou **`admin`**; senha = **`1234`**. O papel de acesso (RBAC) é derivado do setor: direção → *Direção*, coordenações → *Coordenador*, demais → *Operador*.

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
| `JWT_SECRET` | `comunica-plus-dev-…` | Segredo de assinatura do JWT (**defina em produção**) |
| `JWT_EXPIRES_IN` | `12h` | Validade do token |

---

## API (resumo)

Todas as rotas exigem `Authorization: Bearer <token>`, exceto as marcadas 🔓 (públicas). 🛡️ = exige papel mínimo (RBAC).

| Método | Rota | Descrição |
| --- | --- | --- |
| `POST` | `/api/auth/register` 🔓 | Cadastra usuário e retorna token |
| `POST` | `/api/auth/login` 🔓 | Autentica (login + senha) e retorna token |
| `GET` | `/api/auth/me` | Usuário autenticado |
| `GET` | `/api/users/sectors` 🔓 | Setores/funções disponíveis |
| `GET` | `/api/users/roles` 🔓 | Papéis de acesso (RBAC) |
| `GET` | `/api/users` 🛡️ Direção+ | Lista de usuários |
| `GET` | `/api/channels` | Lista canais |
| `GET` | `/api/transmissions?channelId=&limit=` | Histórico de transmissões |
| `GET` | `/api/transmissions/:id/audio` | Reproduz áudio original |
| `POST` | `/api/transmissions/:id/receipts` | Confirma recebimento/escuta |
| `GET` | `/api/transmissions/stats` | Estatísticas do painel |
| `GET` | `/api/search?q=` | Busca inteligente (palavra ou pergunta) |
| `GET` | `/api/occurrences` | Livro de Ocorrências |
| `PATCH` | `/api/occurrences/:id/status` 🛡️ Coordenador+ | Avança status da ocorrência |

**WebSocket (Socket.IO):** autenticado por token no handshake (`auth: { token }`). `identify`, `join_channel`, `ptt_start`, `ptt_end`, `ptt_cancel` →
eventos `presence`, `ptt_started`, `ptt_ended`, `ptt_interrupted`, `transmission_created`, `unauthorized`.
**Sinalização WebRTC (voz ao vivo):** `webrtc_join`, `webrtc_offer`, `webrtc_answer`, `webrtc_ice` (relay P2P por par).

---

## Estrutura

```
src/
  common/        enums e tipos do domínio (setores, prioridades, papéis, status) + hash de senha
  database/      conexão SQLite + esquema (FTS5) + migrações
  ai/            camada de IA (stub determinístico: transcrição/resumo/prioridade/ocorrência)
  auth/          autenticação JWT + RBAC (guards, decorators @Public/@Roles)
  users/         usuários, setores e papéis
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
