import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { Role, ROLE_LABELS, Sector, SECTOR_LABELS } from '../common/enums';
import { Public, Roles } from '../auth/decorators';

@Controller('api/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** Setores disponíveis (público-alvo do sistema). Público (tela de cadastro). */
  @Public()
  @Get('sectors')
  sectors() {
    return Object.values(Sector).map((key) => ({ key, label: SECTOR_LABELS[key] }));
  }

  /** Papéis de acesso (RBAC). Público (tela de cadastro). */
  @Public()
  @Get('roles')
  roles() {
    return Object.values(Role).map((key) => ({ key, label: ROLE_LABELS[key] }));
  }

  /** Lista de usuários — restrita à direção/administração. */
  @Roles(Role.DIRETOR)
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
}
