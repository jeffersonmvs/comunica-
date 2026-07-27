import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { AiService } from '../ai/ai.service';
import { ChannelsService } from '../channels/channels.service';
import { UsersService } from '../users/users.service';
import { OccurrencesService } from '../occurrences/occurrences.service';
import { isPriority, Priority, ReceiptType, Sector, SECTOR_LABELS } from '../common/enums';
import { Occurrence, Receipt, Transmission } from '../common/types';
import { CreateTransmissionInput } from './dto';

interface TransmissionRow {
  id: string;
  channel_id: string;
  user_id: string;
  priority: string;
  started_at: string;
  duration_ms: number;
  audio_path: string | null;
  mime_type: string | null;
  transcript: string;
  summary: string;
  keywords: string;
  created_at: string;
  channel_key: string;
  channel_name: string;
  user_name: string;
  sector: string;
}

const SELECT_TX = `
  SELECT t.*, c.key AS channel_key, c.name AS channel_name,
         u.name AS user_name, u.sector AS sector
  FROM transmissions t
  JOIN channels c ON c.id = t.channel_id
  JOIN users u ON u.id = t.user_id
`;

@Injectable()
export class TransmissionsService {
  private readonly audioDir =
    process.env.AUDIO_DIR || path.join(process.cwd(), 'data', 'audio');

  constructor(
    private readonly database: DatabaseService,
    private readonly ai: AiService,
    private readonly channels: ChannelsService,
    private readonly users: UsersService,
    private readonly occurrences: OccurrencesService,
  ) {
    fs.mkdirSync(this.audioDir, { recursive: true });
  }

  private toTransmission(row: TransmissionRow): Transmission {
    return {
      id: row.id,
      channelId: row.channel_id,
      channelKey: row.channel_key,
      channelName: row.channel_name,
      userId: row.user_id,
      userName: row.user_name,
      sector: row.sector as Sector,
      priority: row.priority as Priority,
      startedAt: row.started_at,
      durationMs: row.duration_ms,
      audioPath: row.audio_path,
      mimeType: row.mime_type,
      transcript: row.transcript,
      summary: row.summary,
      keywords: JSON.parse(row.keywords || '[]') as string[],
      createdAt: row.created_at,
    };
  }

  private extForMime(mime?: string | null): string {
    if (!mime) return 'bin';
    if (mime.includes('webm')) return 'webm';
    if (mime.includes('ogg')) return 'ogg';
    if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
    if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
    if (mime.includes('wav')) return 'wav';
    return 'bin';
  }

  private storeAudio(id: string, base64?: string, mime?: string): string | null {
    if (!base64) return null;
    const raw = base64.includes(',') ? base64.split(',')[1] : base64;
    const buffer = Buffer.from(raw, 'base64');
    if (buffer.length === 0) return null;
    const filename = `${id}.${this.extForMime(mime)}`;
    fs.writeFileSync(path.join(this.audioDir, filename), buffer);
    return filename; // caminho relativo ao AUDIO_DIR
  }

  /**
   * Registra uma transmissão de ponta a ponta:
   * áudio → IA (transcrição/resumo/prioridade/keywords) → persistência →
   * índice de busca → possível ocorrência automática. Nada é perdido.
   */
  create(input: CreateTransmissionInput): { transmission: Transmission; occurrence: Occurrence | null } {
    if (!isPriority(input.priority)) throw new BadRequestException('Prioridade inválida.');
    const channel = this.channels.findById(input.channelId);
    if (!channel) throw new NotFoundException('Canal não encontrado.');
    const user = this.users.findById(input.userId);
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    const id = uuid();
    const now = new Date().toISOString();
    const analysis = this.ai.analyze(input.transcript || '', user.sector, input.priority);
    const audioPath = this.storeAudio(id, input.audioBase64, input.mimeType);

    this.database.db
      .prepare(
        `INSERT INTO transmissions
          (id, channel_id, user_id, priority, started_at, duration_ms, audio_path, mime_type, transcript, summary, keywords, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        channel.id,
        user.id,
        analysis.suggestedPriority,
        input.startedAt || now,
        input.durationMs || 0,
        audioPath,
        input.mimeType || null,
        analysis.transcript,
        analysis.summary,
        JSON.stringify(analysis.keywords),
        now,
      );

    // Indexa para busca inteligente (FTS5).
    this.database.db
      .prepare(
        `INSERT INTO transmissions_fts (transmission_id, transcript, summary, keywords, sector, channel)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        analysis.transcript,
        analysis.summary,
        analysis.keywords.join(' '),
        SECTOR_LABELS[user.sector],
        channel.name,
      );

    const transmission = this.findById(id);

    // Livro de Ocorrências Inteligente: gera entrada estruturada, se aplicável.
    let occurrence: Occurrence | null = null;
    if (analysis.occurrence.isOccurrence) {
      occurrence = this.occurrences.create({
        transmissionId: id,
        category: analysis.occurrence.category,
        sector: user.sector,
        priority: analysis.suggestedPriority,
        title: analysis.occurrence.title,
        summary: analysis.summary,
        responsible: analysis.occurrence.responsible,
      });
    }

    return { transmission, occurrence };
  }

  list(channelId?: string, limit = 50): Transmission[] {
    const rows = (
      channelId
        ? this.database.db
            .prepare(`${SELECT_TX} WHERE t.channel_id = ? ORDER BY t.started_at DESC LIMIT ?`)
            .all(channelId, limit)
        : this.database.db
            .prepare(`${SELECT_TX} ORDER BY t.started_at DESC LIMIT ?`)
            .all(limit)
    ) as TransmissionRow[];
    return rows.map((r) => this.toTransmission(r));
  }

  findById(id: string): Transmission {
    const row = this.database.db
      .prepare(`${SELECT_TX} WHERE t.id = ?`)
      .get(id) as TransmissionRow | undefined;
    if (!row) throw new NotFoundException('Transmissão não encontrada.');
    return this.toTransmission(row);
  }

  getAudioFile(id: string): { fullPath: string; mimeType: string } {
    const tx = this.findById(id);
    if (!tx.audioPath) throw new NotFoundException('Esta transmissão não possui áudio.');
    const fullPath = path.join(this.audioDir, tx.audioPath);
    if (!fs.existsSync(fullPath)) throw new NotFoundException('Arquivo de áudio ausente.');
    return { fullPath, mimeType: tx.mimeType || 'application/octet-stream' };
  }

  addReceipt(transmissionId: string, userId: string, type: ReceiptType): Receipt {
    const tx = this.findById(transmissionId);
    const user = this.users.findById(userId);
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    const id = uuid();
    const at = new Date().toISOString();
    this.database.db
      .prepare(
        `INSERT OR IGNORE INTO receipts (id, transmission_id, user_id, type, at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, tx.id, user.id, type, at);
    return { id, transmissionId: tx.id, userId: user.id, userName: user.name, type, at };
  }

  getReceipts(transmissionId: string): Receipt[] {
    const rows = this.database.db
      .prepare(
        `SELECT r.*, u.name AS user_name FROM receipts r
         JOIN users u ON u.id = r.user_id
         WHERE r.transmission_id = ? ORDER BY r.at`,
      )
      .all(transmissionId) as Array<{
      id: string;
      transmission_id: string;
      user_id: string;
      user_name: string;
      type: string;
      at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      transmissionId: r.transmission_id,
      userId: r.user_id,
      userName: r.user_name,
      type: r.type as ReceiptType,
      at: r.at,
    }));
  }

  /** Estatísticas para o Painel Operacional. */
  stats() {
    const db = this.database.db;
    const total = (db.prepare('SELECT COUNT(*) AS n FROM transmissions').get() as { n: number }).n;
    const today = new Date().toISOString().slice(0, 10);
    const todayCount = (
      db.prepare('SELECT COUNT(*) AS n FROM transmissions WHERE substr(started_at,1,10) = ?').get(today) as {
        n: number;
      }
    ).n;
    const byPriority = db
      .prepare('SELECT priority, COUNT(*) AS n FROM transmissions GROUP BY priority')
      .all() as Array<{ priority: string; n: number }>;
    return { total, today: todayCount, byPriority };
  }
}
