import { Controller, Get } from '@nestjs/common';
import { ChannelsService } from './channels.service';

@Controller('api/channels')
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Get()
  list() {
    return this.channels.list();
  }
}
