import { Module } from '@nestjs/common';
import { TransmissionsController } from './transmissions.controller';
import { TransmissionsService } from './transmissions.service';
import { ChannelsModule } from '../channels/channels.module';
import { UsersModule } from '../users/users.module';
import { OccurrencesModule } from '../occurrences/occurrences.module';

@Module({
  imports: [ChannelsModule, UsersModule, OccurrencesModule],
  controllers: [TransmissionsController],
  providers: [TransmissionsService],
  exports: [TransmissionsService],
})
export class TransmissionsModule {}
