import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import * as fs from 'fs';
import { TransmissionsService } from './transmissions.service';
import { ReceiptType } from '../common/enums';

@Controller('api/transmissions')
export class TransmissionsController {
  constructor(private readonly transmissions: TransmissionsService) {}

  @Get()
  list(@Query('channelId') channelId?: string, @Query('limit') limit?: string) {
    return this.transmissions.list(channelId, limit ? parseInt(limit, 10) : 50);
  }

  @Get('stats')
  stats() {
    return this.transmissions.stats();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.transmissions.findById(id);
  }

  /** Reprodução do áudio original (registro permanente). */
  @Get(':id/audio')
  audio(@Param('id') id: string, @Res() res: Response) {
    const { fullPath, mimeType } = this.transmissions.getAudioFile(id);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Accept-Ranges', 'bytes');
    fs.createReadStream(fullPath).pipe(res);
  }

  @Get(':id/receipts')
  receipts(@Param('id') id: string) {
    return this.transmissions.getReceipts(id);
  }

  /** Confirmação de recebimento / escuta (rastreabilidade). */
  @Post(':id/receipts')
  addReceipt(@Param('id') id: string, @Body() body: { userId: string; type: ReceiptType }) {
    return this.transmissions.addReceipt(id, body?.userId, body?.type);
  }
}
