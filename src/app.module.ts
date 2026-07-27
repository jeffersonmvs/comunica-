import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from './database/database.module';
import { AiModule } from './ai/ai.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ChannelsModule } from './channels/channels.module';
import { OccurrencesModule } from './occurrences/occurrences.module';
import { TransmissionsModule } from './transmissions/transmissions.module';
import { SearchModule } from './search/search.module';
import { SfuModule } from './sfu/sfu.module';
import { RealtimeModule } from './realtime/realtime.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';

@Module({
  imports: [
    DatabaseModule,
    AiModule,
    AuthModule,
    UsersModule,
    ChannelsModule,
    OccurrencesModule,
    TransmissionsModule,
    SearchModule,
    SfuModule,
    RealtimeModule,
  ],
  providers: [
    // Ordem importa: autenticação (JWT) antes da autorização (papéis).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
