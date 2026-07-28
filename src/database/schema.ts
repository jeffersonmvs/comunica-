/**
 * Esquema SQLite do COMUNICA+.
 *
 * No produto final o banco principal é PostgreSQL + banco vetorial para busca
 * semântica. Aqui usamos SQLite (zero infraestrutura) com FTS5 para a "busca
 * inteligente" por palavra-chave/texto. As tabelas foram desenhadas para
 * migração direta ao Postgres.
 */
export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  sector        TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'operador',
  password_hash TEXT,
  login         TEXT UNIQUE,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transmissions (
  id          TEXT PRIMARY KEY,
  channel_id  TEXT NOT NULL REFERENCES channels(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  priority    TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  audio_path  TEXT,
  mime_type   TEXT,
  transcript  TEXT NOT NULL DEFAULT '',
  summary     TEXT NOT NULL DEFAULT '',
  keywords    TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_channel ON transmissions(channel_id, started_at);
CREATE INDEX IF NOT EXISTS idx_tx_started ON transmissions(started_at);

CREATE TABLE IF NOT EXISTS occurrences (
  id             TEXT PRIMARY KEY,
  transmission_id TEXT REFERENCES transmissions(id),
  category       TEXT NOT NULL,
  sector         TEXT NOT NULL,
  priority       TEXT NOT NULL,
  title          TEXT NOT NULL,
  summary        TEXT NOT NULL DEFAULT '',
  responsible    TEXT,
  status         TEXT NOT NULL,
  opened_at      TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  history        TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_occ_status ON occurrences(status, opened_at);

CREATE TABLE IF NOT EXISTS receipts (
  id             TEXT PRIMARY KEY,
  transmission_id TEXT NOT NULL REFERENCES transmissions(id),
  user_id        TEXT NOT NULL REFERENCES users(id),
  type           TEXT NOT NULL,
  at             TEXT NOT NULL,
  UNIQUE(transmission_id, user_id, type)
);

-- Índice de busca inteligente (full-text). Aproxima a "busca semântica"
-- do produto final; substituível por um banco vetorial sem mudar a API.
-- transmission_id fica UNINDEXED: guardado mas não tokenizado, para recuperar
-- a transmissão original a partir de um acerto de busca.
CREATE VIRTUAL TABLE IF NOT EXISTS transmissions_fts USING fts5(
  transmission_id UNINDEXED,
  transcript,
  summary,
  keywords,
  sector,
  channel
);
`;
