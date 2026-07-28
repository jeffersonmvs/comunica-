import { BadRequestException, Injectable } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { defaultRoleForSector, isRole, isSector, Role, Sector } from '../common/enums';
import { User } from '../common/types';
import { hashPassword, verifyPassword } from '../common/password';

interface UserRow {
  id: string;
  name: string;
  sector: string;
  role: string;
  password_hash: string | null;
  login: string | null;
  created_at: string;
}

export interface CreateUserInput {
  name: string;
  sector: string;
  role?: string;
  login?: string;
  password?: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly database: DatabaseService) {}

  private toUser(row: UserRow): User {
    return {
      id: row.id,
      name: row.name,
      sector: row.sector as Sector,
      role: (row.role as Role) || Role.OPERADOR,
      createdAt: row.created_at,
    };
  }

  private rowById(id: string): UserRow | undefined {
    return this.database.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  }

  list(): User[] {
    const rows = this.database.db.prepare('SELECT * FROM users ORDER BY name').all() as UserRow[];
    return rows.map((r) => this.toUser(r));
  }

  findById(id: string): User | null {
    const row = this.rowById(id);
    return row ? this.toUser(row) : null;
  }

  findByLogin(login: string): UserRow | undefined {
    return this.database.db
      .prepare('SELECT * FROM users WHERE login = ?')
      .get(login) as UserRow | undefined;
  }

  create(input: CreateUserInput): User {
    const name = (input.name || '').trim();
    if (!name) throw new BadRequestException('Nome é obrigatório.');
    if (!isSector(input.sector)) throw new BadRequestException('Setor inválido.');

    const role = input.role && isRole(input.role) ? (input.role as Role) : defaultRoleForSector(input.sector as Sector);
    const login = (input.login || '').trim().toLowerCase() || null;
    if (login && this.findByLogin(login)) {
      throw new BadRequestException('Login já em uso.');
    }
    const passwordHash = input.password ? hashPassword(input.password) : null;

    const user: User = {
      id: uuid(),
      name,
      sector: input.sector as Sector,
      role,
      createdAt: new Date().toISOString(),
    };
    this.database.db
      .prepare(
        'INSERT INTO users (id, name, sector, role, password_hash, login, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(user.id, user.name, user.sector, user.role, passwordHash, login, user.createdAt);
    return user;
  }

  /** Valida credenciais (login + senha). Retorna o usuário público ou null. */
  validateCredentials(login: string, password: string): User | null {
    const row = this.findByLogin((login || '').trim().toLowerCase());
    if (!row) return null;
    if (!verifyPassword(password, row.password_hash)) return null;
    return this.toUser(row);
  }

  /** Cria (idempotente por login) um usuário com senha — usado no seed. */
  ensure(input: CreateUserInput & { login: string }): User {
    const existing = this.findByLogin(input.login.toLowerCase());
    if (existing) return this.toUser(existing);
    return this.create(input);
  }
}
