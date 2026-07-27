import { Module, OnModuleInit } from '@nestjs/common';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';

@Module({
  controllers: [ChannelsController],
  providers: [ChannelsService],
  exports: [ChannelsService],
})
export class ChannelsModule implements OnModuleInit {
  constructor(private readonly channels: ChannelsService) {}

  onModuleInit(): void {
    this.channels.seedDefaults();
  }
}
