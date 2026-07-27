import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { TransmissionsService } from '../transmissions/transmissions.service';
import { Transmission } from '../common/types';

/**
 * Busca inteligente. Aceita tanto palavras soltas ("anestesista") quanto
 * perguntas em linguagem natural ("quem falou sobre falta de oxigênio?").
 *
 * Estratégia (stub): remove palavras interrogativas/stopwords, monta uma
 * consulta FTS5 com prefixos e OR, e ordena por relevância (bm25). No produto
 * final este mesmo contrato seria atendido por um banco vetorial (embeddings).
 */
@Injectable()
export class SearchService {
  private static readonly QUESTION_STOPWORDS = new Set([
    'quem','falou','sobre','onde','quando','qual','quais','como','porque','por','que','o','a','os','as',
    'de','do','da','dos','das','em','no','na','sobre','um','uma','foi','houve','teve','disse','comentou',
    'falaram','aconteceu','com','para','e','ou','me','mostra','mostrar','buscar','procurar','encontrar',
  ]);

  constructor(
    private readonly database: DatabaseService,
    private readonly transmissions: TransmissionsService,
  ) {}

  private buildMatchQuery(raw: string): string {
    const terms = raw
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !SearchService.QUESTION_STOPWORDS.has(t));

    if (terms.length === 0) return '';
    // Cada termo como prefixo; OR entre eles para recall amplo.
    return terms.map((t) => `"${t}"*`).join(' OR ');
  }

  search(query: string): { query: string; matchQuery: string; results: Transmission[] } {
    const matchQuery = this.buildMatchQuery(query || '');
    if (!matchQuery) return { query, matchQuery, results: [] };

    let ids: string[] = [];
    try {
      const rows = this.database.db
        .prepare(
          `SELECT transmission_id FROM transmissions_fts
           WHERE transmissions_fts MATCH ?
           ORDER BY bm25(transmissions_fts) LIMIT 50`,
        )
        .all(matchQuery) as Array<{ transmission_id: string }>;
      ids = rows.map((r) => r.transmission_id);
    } catch {
      // Consulta malformada para o FTS — retorna vazio em vez de estourar.
      return { query, matchQuery, results: [] };
    }

    const results = ids
      .map((id) => {
        try {
          return this.transmissions.findById(id);
        } catch {
          return null;
        }
      })
      .filter((t): t is Transmission => t !== null);

    return { query, matchQuery, results };
  }
}
