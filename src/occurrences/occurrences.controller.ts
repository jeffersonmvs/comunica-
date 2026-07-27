import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { OccurrencesService } from './occurrences.service';
import { OccurrenceStatus, OCCURRENCE_STATUS_LABELS, Role } from '../common/enums';
import { Roles } from '../auth/decorators';

@Controller('api/occurrences')
export class OccurrencesController {
  constructor(private readonly occurrences: OccurrencesService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.occurrences.list(status);
  }

  @Get('statuses')
  statuses() {
    return Object.values(OccurrenceStatus).map((key) => ({
      key,
      label: OCCURRENCE_STATUS_LABELS[key],
    }));
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.occurrences.findById(id);
  }

  /** Alterar o status de uma ocorrência exige coordenador ou acima. */
  @Roles(Role.COORDENADOR)
  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() body: { status: OccurrenceStatus; note?: string },
  ) {
    return this.occurrences.updateStatus(id, body?.status, body?.note);
  }
}
