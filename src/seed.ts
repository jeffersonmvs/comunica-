import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { UsersService } from './users/users.service';
import { ChannelsService } from './channels/channels.service';
import { defaultRoleForSector, Role, Sector, SECTOR_LABELS } from './common/enums';

/**
 * Popula canais padrão e um usuário demo por setor (com login/senha/papel),
 * mais um administrador, para que a plataforma já suba pronta para uso.
 *
 * Credenciais demo: login = chave do setor, senha = "1234".
 * Ex.: login "centro_cirurgico" / senha "1234".  Admin: "admin" / "1234".
 */
async function seed() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const logger = new Logger('Seed');
  const users = app.get(UsersService);
  const channels = app.get(ChannelsService);

  channels.seedDefaults();

  let created = 0;
  for (const sector of Object.values(Sector)) {
    const login = sector; // a própria chave do setor
    const before = users.findByLogin(login);
    users.ensure({
      name: SECTOR_LABELS[sector],
      sector,
      role: defaultRoleForSector(sector),
      login,
      password: '1234',
    });
    if (!before) created++;
  }

  // Administrador do sistema.
  if (!users.findByLogin('admin')) {
    users.ensure({
      name: 'Administrador',
      sector: Sector.DIRETOR_GERAL,
      role: Role.ADMIN,
      login: 'admin',
      password: '1234',
    });
    created++;
  }

  logger.log(`Canais garantidos: ${channels.list().length}`);
  logger.log(`Usuários demo criados: ${created} (total: ${users.list().length})`);
  logger.log('Credenciais demo: login = chave do setor (ou "admin"), senha = "1234".');
  await app.close();
}

seed().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Falha no seed:', err);
  process.exit(1);
});
