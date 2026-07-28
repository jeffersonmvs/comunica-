import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { SCHEMA_SQL } from './schema';

/**
 * Encapsula a conexão SQLite (better-sqlite3, síncrono). Abre o arquivo e cria
 * o esquema no CONSTRUTOR — assim o banco está pronto antes de qualquer hook
 * onModuleInit de outros módulos (a ordem entre módulos globais não é garantida).
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly _db: Database.Database;

  constructor() {
    const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'comunica.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this._db = new Database(dbPath);
    this._db.pragma('journal_mode = WAL');
    this._db.exec(SCHEMA_SQL);
    this.migrate();
  }

  /** Migrações idempotentes para bancos criados antes de novas colunas. */
  private migrate(): void {
    const cols = (this._db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    if (!cols.includes('role')) {
      this._db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'operador'`);
    }
    if (!cols.includes('password_hash')) {
      this._db.exec(`ALTER TABLE users ADD COLUMN password_hash TEXT`);
    }
    if (!cols.includes('login')) {
      this._db.exec(`ALTER TABLE users ADD COLUMN login TEXT`);
      this._db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_login ON users(login)`);
    }
  }

  get db(): Database.Database {
    return this._db;
  }

  onModuleDestroy(): void {
    this._db?.close();
  }
}
