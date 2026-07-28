# Publicar o COMUNICA+ no Render

Guia para colocar o COMUNICA+ no ar com um **link HTTPS** para testes.
O app é um servidor Node persistente (WebSocket + dependências nativas), então
usamos um **Docker Web Service** do Render (não serverless).

> **Voz ao vivo no Render:** o Render não expõe UDP, então o **SFU fica desligado**
> (`SFU_ENABLED=false`) e a voz ao vivo usa **WebRTC P2P** (funciona
> navegador‑a‑navegador). Tudo o mais — PTT, registro, transcrição, IA,
> ocorrências, busca, login/RBAC — funciona 100%. Para SFU real (muitos ouvintes
> por canal), use Fly.io ou um VPS (ver `docs/ARCHITECTURE.md`).

## Pré‑requisitos

- Conta gratuita no [Render](https://render.com) conectada ao GitHub.
- Este repositório no GitHub (`jeffersonmvs/comunica-`).
- Os arquivos de deploy (`Dockerfile`, `render.yaml`) precisam estar na branch
  que o Render vai construir. Eles estão na branch do PR #2
  (`claude/comunica-hospital-ptt-550qr0`). **Faça o merge do PR #2 para a `main`**
  ou aponte o Render para essa branch (passo 2).

## Opção A — Blueprint (1 clique, usa `render.yaml`)

1. No Render: **New +** → **Blueprint**.
2. Selecione o repositório `jeffersonmvs/comunica-`.
3. O Render lê o `render.yaml` (serviço `comunica-plus`, Docker, plano free,
   `SFU_ENABLED=false`, `JWT_SECRET` gerado). Clique em **Apply**.
4. Aguarde o build (~3–5 min). Ao terminar, o serviço mostra a **URL**
   `https://comunica-plus-XXXX.onrender.com` — abra e teste.

## Opção B — Manual (Web Service Docker)

1. **New +** → **Web Service** → conecte o repositório.
2. **Branch:** `main` (após o merge) ou `claude/comunica-hospital-ptt-550qr0`.
3. **Runtime/Language:** Docker. **Instance Type:** Free.
4. **Health Check Path:** `/`
5. **Environment Variables:**
   | Key | Value |
   | --- | --- |
   | `SFU_ENABLED` | `false` |
   | `JWT_SECRET` | *(clique em Generate)* |
   | `JWT_EXPIRES_IN` | `12h` |
   (Não defina `PORT` — o Render injeta automaticamente.)
6. **Create Web Service** e aguarde o deploy. A URL aparece no topo.

## Primeiro acesso

- Abra a URL. Na aba **Entrar**, use uma credencial demo (criada no boot):
  - **login:** `admin` (ou a chave de um setor: `centro_cirurgico`, `uti`,
    `diretoria`, `emergencia`, `enfermagem`, `farmacia`, `manutencao`…)
  - **senha:** `1234`
- Ou cadastre um novo usuário na aba **Cadastrar**.

## Testar a voz ao vivo

Abra a URL em **duas abas** (ou dois dispositivos) com usuários diferentes,
entre no **mesmo canal** e **segure para falar** em um deles — o outro ouve.
No Render a mídia vai por **P2P** (WebRTC direto entre navegadores).

## Build enxuto (sem compilar o SFU)

No Render o SFU não é usado (sem UDP), então a imagem **não compila o worker
nativo do mediasoup**: ele é uma dependência **opcional**, e o `Dockerfile`
instala com `npm ci --omit=optional` por padrão. Resultado: build rápido e
confiável, sem o passo pesado de compilação C++. Em runtime, a voz ao vivo cai
para **P2P** automaticamente.

Para uma imagem **com SFU real** (Fly.io/VPS, onde há UDP), construa com o build
arg `WITH_SFU=1` — aí o mediasoup é instalado e o worker é compilado:

```bash
docker build --build-arg WITH_SFU=1 -t comunica-plus:sfu .
```

## Observações

- **Disco efêmero (plano free):** o banco SQLite e os áudios são recriados a
  cada reinício/deploy; os usuários demo são **repopulados no boot**
  (`start:prod`). Para persistir, use plano pago e habilite o `disk` comentado
  no `render.yaml` (monta `/app/data`).
- **Cold start (free):** o serviço hiberna após inatividade; o primeiro acesso
  pode levar ~30 s para acordar.
- **Logs:** acompanhe build e execução na aba **Logs** do serviço no Render.
