import { Module } from '@nestjs/common';
import { PttGateway } from './ptt.gateway';
import { UsersModule } from '../users/users.module';
import { TransmissionsModule } from '../transmissions/transmissions.module';

@Module({
  imports: [UsersModule, TransmissionsModule],
  providers: [PttGateway],
})
export class RealtimeModule {}
