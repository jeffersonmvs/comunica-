import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { JWT_EXPIRES_IN, JWT_SECRET, JwtPayload } from './jwt.constants';
import { User } from '../common/types';

export interface AuthResult {
  token: string;
  user: User;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  private sign(user: User): string {
    const payload: JwtPayload = {
      sub: user.id,
      name: user.name,
      sector: user.sector,
      role: user.role,
    };
    return this.jwt.sign(payload, { secret: JWT_SECRET, expiresIn: JWT_EXPIRES_IN });
  }

  register(body: {
    name: string;
    sector: string;
    role?: string;
    login: string;
    password: string;
  }): AuthResult {
    if (!body?.login?.trim()) throw new BadRequestException('Login é obrigatório.');
    if (!body?.password || body.password.length < 4) {
      throw new BadRequestException('Senha deve ter ao menos 4 caracteres.');
    }
    const user = this.users.create({
      name: body.name,
      sector: body.sector,
      role: body.role,
      login: body.login,
      password: body.password,
    });
    return { token: this.sign(user), user };
  }

  login(body: { login: string; password: string }): AuthResult {
    const user = this.users.validateCredentials(body?.login, body?.password);
    if (!user) throw new UnauthorizedException('Login ou senha inválidos.');
    return { token: this.sign(user), user };
  }

  /** Verifica um token (usado também pelo gateway WebSocket). */
  verify(token: string): JwtPayload {
    return this.jwt.verify<JwtPayload>(token, { secret: JWT_SECRET });
  }
}
