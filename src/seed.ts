import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { UsersService } from './users/users.service';
import { ChannelsService } from './channels/channels.service';
import { Sector, SECTOR_LABELS } from './common/enums';

/**
 * Popula canais padrão e um usuário demo por setor, para que a plataforma
 * já suba com o público-alvo do conceito pronto para uso.
 */
async function seed() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const logger = new Logger('Seed');
  const users = app.get(UsersService);
  const channels = app.get(ChannelsService);

  channels.seedDefaults();

  let created = 0;
  for (const sector of Object.values(Sector)) {
    const existing = users.list().find((u) => u.sector === sector);
    if (!existing) {
      users.ensure(SECTOR_LABELS[sector], sector);
      created++;
    }
  }

  logger.log(`Canais garantidos: ${channels.list().length}`);
  logger.log(`Usuários demo criados: ${created} (total: ${users.list().length})`);
  await app.close();
}

seed().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Falha no seed:', err);
  process.exit(1);
});
