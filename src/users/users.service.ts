import { BadRequestException, Injectable } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { isSector, Sector } from '../common/enums';
import { User } from '../common/types';

interface UserRow {
  id: string;
  name: string;
  sector: string;
  created_at: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly database: DatabaseService) {}

  private toUser(row: UserRow): User {
    return {
      id: row.id,
      name: row.name,
      sector: row.sector as Sector,
      createdAt: row.created_at,
    };
  }

  list(): User[] {
    const rows = this.database.db
      .prepare('SELECT * FROM users ORDER BY name')
      .all() as UserRow[];
    return rows.map((r) => this.toUser(r));
  }

  findById(id: string): User | null {
    const row = this.database.db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(id) as UserRow | undefined;
    return row ? this.toUser(row) : null;
  }

  create(name: string, sector: string): User {
    const trimmed = (name || '').trim();
    if (!trimmed) throw new BadRequestException('Nome é obrigatório.');
    if (!isSector(sector)) throw new BadRequestException('Setor inválido.');

    const user: User = {
      id: uuid(),
      name: trimmed,
      sector: sector as Sector,
      createdAt: new Date().toISOString(),
    };
    this.database.db
      .prepare('INSERT INTO users (id, name, sector, created_at) VALUES (?, ?, ?, ?)')
      .run(user.id, user.name, user.sector, user.createdAt);
    return user;
  }

  /** Cria se não existir (idempotente por nome+setor) — usado no seed/login rápido. */
  ensure(name: string, sector: Sector): User {
    const existing = this.database.db
      .prepare('SELECT * FROM users WHERE name = ? AND sector = ?')
      .get(name, sector) as UserRow | undefined;
    if (existing) return this.toUser(existing);
    return this.create(name, sector);
  }
}
