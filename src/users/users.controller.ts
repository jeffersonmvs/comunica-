import { Body, Controller, Get, Param, NotFoundException, Post } from '@nestjs/common';
import { UsersService } from './users.service';
import { Sector, SECTOR_LABELS } from '../common/enums';

@Controller('api/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** Lista os setores disponíveis (público-alvo do sistema). */
  @Get('sectors')
  sectors() {
    return Object.values(Sector).map((key) => ({ key, label: SECTOR_LABELS[key] }));
  }

  @Get()
  list() {
    return this.users.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    const user = this.users.findById(id);
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    return user;
  }

  @Post()
  create(@Body() body: { name: string; sector: string }) {
    return this.users.create(body?.name, body?.sector);
  }
}
