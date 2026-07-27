/* Smoke test do COMUNICA+ — valida o pipeline central sem HTTP.
 * Boota o contexto Nest, registra uma transmissão e verifica:
 *   transcrição → resumo → palavras-chave → busca (FTS) → ocorrência automática.
 *
 * Uso: npm run build && npm run smoke
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

// Banco/áudio isolados para o teste.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comunica-smoke-'));
process.env.DATABASE_PATH = path.join(tmp, 'smoke.db');
process.env.AUDIO_DIR = path.join(tmp, 'audio');

require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { UsersService } = require('../dist/users/users.service');
const { ChannelsService } = require('../dist/channels/channels.service');
const { TransmissionsService } = require('../dist/transmissions/transmissions.service');
const { SearchService } = require('../dist/search/search.service');
const { OccurrencesService } = require('../dist/occurrences/occurrences.service');
const { AuthService } = require('../dist/auth/auth.service');

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log('  ✓ ' + msg);
  } else {
    console.error('  ✗ ' + msg);
    failures++;
  }
}

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const users = app.get(UsersService);
  const channels = app.get(ChannelsService);
  const transmissions = app.get(TransmissionsService);
  const search = app.get(SearchService);
  const occurrences = app.get(OccurrencesService);
  const auth = app.get(AuthService);

  channels.seedDefaults();

  console.log('\n[0] Autenticação + RBAC');
  const reg = auth.register({
    name: 'Dr. Teste Cirúrgico', sector: 'centro_cirurgico', login: 'teste_cc', password: 'senha123',
  });
  assert(!!reg.token && !!reg.user.id, 'register retorna token + usuário');
  assert(reg.user.role === 'coordenador', 'papel default por setor (CC → coordenador): ' + reg.user.role);
  const good = auth.login({ login: 'teste_cc', password: 'senha123' });
  assert(good.user.id === reg.user.id, 'login com senha correta autentica');
  let badRejected = false;
  try { auth.login({ login: 'teste_cc', password: 'errada' }); } catch { badRejected = true; }
  assert(badRejected, 'login com senha errada é rejeitado');
  const payload = auth.verify(good.token);
  assert(payload.sub === reg.user.id && payload.role === 'coordenador', 'JWT verificável com sub + role');

  console.log('\n[1] Usuários e canais');
  const user = reg.user;
  assert(!!user.id, 'usuário criado');
  const channel = channels.findByKey('centro_cirurgico');
  assert(!!channel, 'canal padrão existe');

  console.log('\n[2] Registro de transmissão + IA');
  const { transmission, occurrence } = transmissions.create({
    channelId: channel.id,
    userId: user.id,
    priority: 'rotina',
    transcript:
      'Estamos suspendendo a cirurgia da sala 3 por falta de anestesista. Acionamos a coordenação e nova previsão é 09:30.',
    durationMs: 4200,
  });
  assert(transmission.transcript.startsWith('Estamos suspendendo'), 'transcrição normalizada');
  assert(transmission.summary.includes('•'), 'resumo em bullets gerado');
  assert(transmission.keywords.length > 0, 'palavras-chave extraídas: ' + transmission.keywords.join(', '));
  assert(
    transmission.priority === 'urgente' || transmission.priority === 'emergencia',
    'prioridade elevada pela IA (detectou "suspend/falta"): ' + transmission.priority,
  );

  console.log('\n[3] Livro de Ocorrências Inteligente');
  assert(!!occurrence, 'ocorrência criada automaticamente');
  assert(occurrence && occurrence.status === 'aberto', 'ocorrência inicia como "aberto"');
  const updated = occurrences.updateStatus(occurrence.id, 'em_andamento', 'Manutenção acionada');
  assert(updated.status === 'em_andamento', 'status avança para "em andamento"');
  assert(updated.history.length === 2, 'histórico de status registrado');

  console.log('\n[4] Busca inteligente (FTS)');
  const r1 = search.search('anestesista');
  assert(r1.results.length >= 1, 'busca por palavra-chave encontra a transmissão');
  const r2 = search.search('quem falou sobre falta de anestesista?');
  assert(r2.results.length >= 1, 'pergunta em linguagem natural também encontra');
  const r3 = search.search('oxigênio');
  assert(r3.results.length === 0, 'termo ausente não retorna falso-positivo');

  console.log('\n[5] Estatísticas do painel');
  const stats = transmissions.stats();
  assert(stats.total === 1, 'contagem total de transmissões');
  assert(stats.today === 1, 'contagem do dia');

  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log('\n' + (failures === 0 ? '✅ Smoke test PASSOU' : `❌ ${failures} verificação(ões) falharam`));
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('Erro no smoke test:', err);
  process.exit(1);
});
