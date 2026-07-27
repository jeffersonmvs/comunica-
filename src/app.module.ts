import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { AiModule } from './ai/ai.module';
import { UsersModule } from './users/users.module';
import { ChannelsModule } from './channels/channels.module';
import { OccurrencesModule } from './occurrences/occurrences.module';
import { TransmissionsModule } from './transmissions/transmissions.module';
import { SearchModule } from './search/search.module';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [
    DatabaseModule,
    AiModule,
    UsersModule,
    ChannelsModule,
    OccurrencesModule,
    TransmissionsModule,
    SearchModule,
    RealtimeModule,
  ],
})
export class AppModule {}
