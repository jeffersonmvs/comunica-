import { Body, Controller, Get, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public, CurrentUser } from './decorators';
import { User } from '../common/types';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  register(
    @Body() body: { name: string; sector: string; role?: string; login: string; password: string },
  ) {
    return this.auth.register(body);
  }

  @Public()
  @Post('login')
  login(@Body() body: { login: string; password: string }) {
    return this.auth.login(body);
  }

  /** Retorna o usuário autenticado (valida o token do cliente). */
  @Get('me')
  me(@CurrentUser() user: User) {
    return user;
  }
}
