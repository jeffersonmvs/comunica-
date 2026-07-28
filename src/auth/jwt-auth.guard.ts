import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JWT_SECRET, JwtPayload } from './jwt.constants';
import { IS_PUBLIC_KEY } from './decorators';
import { UsersService } from '../users/users.service';

/**
 * Guard global: exige um Bearer token válido, exceto em rotas marcadas com
 * @Public(). Ao validar, injeta o usuário atual em `req.user`.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly users: UsersService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const header: string = req.headers?.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('Token ausente.');

    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(token, { secret: JWT_SECRET });
    } catch {
      throw new UnauthorizedException('Token inválido ou expirado.');
    }
    const user = this.users.findById(payload.sub);
    if (!user) throw new UnauthorizedException('Usuário não encontrado.');
    req.user = user;
    return true;
  }
}
