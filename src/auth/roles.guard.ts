import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './decorators';
import { Role, ROLE_RANK } from '../common/enums';
import { User } from '../common/types';

/**
 * Autorização por papel. @Roles(Role.COORDENADOR) libera COORDENADOR e acima
 * (hierarquia por ROLE_RANK). Deve rodar depois do JwtAuthGuard.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const user: User | undefined = req.user;
    if (!user) throw new ForbiddenException('Não autenticado.');

    const minRank = Math.min(...required.map((r) => ROLE_RANK[r]));
    if (ROLE_RANK[user.role] < minRank) {
      throw new ForbiddenException('Permissão insuficiente para esta ação.');
    }
    return true;
  }
}
