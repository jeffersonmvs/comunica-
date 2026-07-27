import { Injectable } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { Channel } from '../common/types';

interface ChannelRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  created_at: string;
}

/** Canais de rádio padrão do hospital (conforme o conceito). */
const DEFAULT_CHANNELS: Array<Pick<Channel, 'key' | 'name' | 'description'>> = [
  { key: 'diretoria', name: '📻 Diretoria', description: 'Direção geral, clínica e técnica' },
  { key: 'centro_cirurgico', name: '📻 Centro Cirúrgico', description: 'Coordenação do bloco cirúrgico' },
  { key: 'emergencia', name: '📻 Emergência', description: 'Coordenação da emergência' },
  { key: 'uti', name: '📻 UTI', description: 'Coordenação da terapia intensiva' },
  { key: 'enfermagem', name: '📻 Enfermagem', description: 'Coordenação de enfermagem' },
  { key: 'engenharia', name: '📻 Engenharia', description: 'Engenharia clínica e infraestrutura' },
  { key: 'farmacia', name: '📻 Farmácia', description: 'Farmácia hospitalar' },
  { key: 'manutencao', name: '📻 Manutenção', description: 'Manutenção predial e equipamentos' },
  { key: 'todos', name: '📻 Todos', description: 'Canal geral — todos os setores' },
];

@Injectable()
export class ChannelsService {
  constructor(private readonly database: DatabaseService) {}

  private toChannel(row: ChannelRow): Channel {
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      createdAt: row.created_at,
    };
  }

  /** Garante que os canais padrão existam (idempotente). */
  seedDefaults(): void {
    const insert = this.database.db.prepare(
      'INSERT OR IGNORE INTO channels (id, key, name, description, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    const now = new Date().toISOString();
    for (const c of DEFAULT_CHANNELS) {
      insert.run(uuid(), c.key, c.name, c.description, now);
    }
  }

  list(): Channel[] {
    const rows = this.database.db
      .prepare(`SELECT * FROM channels ORDER BY key = 'todos', name`)
      .all() as ChannelRow[];
    return rows.map((r) => this.toChannel(r));
  }

  findById(id: string): Channel | null {
    const row = this.database.db
      .prepare('SELECT * FROM channels WHERE id = ?')
      .get(id) as ChannelRow | undefined;
    return row ? this.toChannel(row) : null;
  }

  findByKey(key: string): Channel | null {
    const row = this.database.db
      .prepare('SELECT * FROM channels WHERE key = ?')
      .get(key) as ChannelRow | undefined;
    return row ? this.toChannel(row) : null;
  }
}
