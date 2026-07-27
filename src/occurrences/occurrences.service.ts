import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { OccurrenceStatus, Priority, Sector } from '../common/enums';
import { Occurrence, OccurrenceHistoryEntry } from '../common/types';

interface OccurrenceRow {
  id: string;
  transmission_id: string | null;
  category: string;
  sector: string;
  priority: string;
  title: string;
  summary: string;
  responsible: string | null;
  status: string;
  opened_at: string;
  updated_at: string;
  history: string;
}

export interface CreateOccurrenceInput {
  transmissionId: string | null;
  category: string;
  sector: Sector;
  priority: Priority;
  title: string;
  summary: string;
  responsible: string | null;
}

@Injectable()
export class OccurrencesService {
  constructor(private readonly database: DatabaseService) {}

  private toOccurrence(row: OccurrenceRow): Occurrence {
    return {
      id: row.id,
      transmissionId: row.transmission_id,
      category: row.category,
      sector: row.sector as Sector,
      priority: row.priority as Priority,
      title: row.title,
      summary: row.summary,
      responsible: row.responsible,
      status: row.status as OccurrenceStatus,
      openedAt: row.opened_at,
      updatedAt: row.updated_at,
      history: JSON.parse(row.history || '[]') as OccurrenceHistoryEntry[],
    };
  }

  create(input: CreateOccurrenceInput): Occurrence {
    const now = new Date().toISOString();
    const history: OccurrenceHistoryEntry[] = [
      { at: now, status: OccurrenceStatus.ABERTO, note: 'Ocorrência aberta automaticamente pela IA.' },
    ];
    const occurrence: Occurrence = {
      id: uuid(),
      transmissionId: input.transmissionId,
      category: input.category,
      sector: input.sector,
      priority: input.priority,
      title: input.title,
      summary: input.summary,
      responsible: input.responsible,
      status: OccurrenceStatus.ABERTO,
      openedAt: now,
      updatedAt: now,
      history,
    };
    this.database.db
      .prepare(
        `INSERT INTO occurrences
          (id, transmission_id, category, sector, priority, title, summary, responsible, status, opened_at, updated_at, history)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        occurrence.id,
        occurrence.transmissionId,
        occurrence.category,
        occurrence.sector,
        occurrence.priority,
        occurrence.title,
        occurrence.summary,
        occurrence.responsible,
        occurrence.status,
        occurrence.openedAt,
        occurrence.updatedAt,
        JSON.stringify(occurrence.history),
      );
    return occurrence;
  }

  list(status?: string): Occurrence[] {
    const rows = (
      status
        ? this.database.db
            .prepare('SELECT * FROM occurrences WHERE status = ? ORDER BY opened_at DESC')
            .all(status)
        : this.database.db.prepare('SELECT * FROM occurrences ORDER BY opened_at DESC').all()
    ) as OccurrenceRow[];
    return rows.map((r) => this.toOccurrence(r));
  }

  findById(id: string): Occurrence {
    const row = this.database.db
      .prepare('SELECT * FROM occurrences WHERE id = ?')
      .get(id) as OccurrenceRow | undefined;
    if (!row) throw new NotFoundException('Ocorrência não encontrada.');
    return this.toOccurrence(row);
  }

  /** Avança o status (Aberto → Em andamento → Resolvido) registrando histórico. */
  updateStatus(id: string, status: OccurrenceStatus, note?: string): Occurrence {
    if (!Object.values(OccurrenceStatus).includes(status)) {
      throw new BadRequestException('Status inválido.');
    }
    const occurrence = this.findById(id);
    const now = new Date().toISOString();
    const history = [
      ...occurrence.history,
      { at: now, status, note: note?.trim() || `Status alterado para ${status}.` },
    ];
    this.database.db
      .prepare('UPDATE occurrences SET status = ?, updated_at = ?, history = ? WHERE id = ?')
      .run(status, now, JSON.stringify(history), id);
    return { ...occurrence, status, updatedAt: now, history };
  }

  countOpen(): number {
    const row = this.database.db
      .prepare(`SELECT COUNT(*) AS n FROM occurrences WHERE status != ?`)
      .get(OccurrenceStatus.RESOLVIDO) as { n: number };
    return row.n;
  }
}
