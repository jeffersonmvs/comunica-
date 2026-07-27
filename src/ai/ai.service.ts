import { Injectable } from '@nestjs/common';
import { Priority, Sector, SECTOR_LABELS } from '../common/enums';
import { AiAnalysis } from '../common/types';

/**
 * Camada de IA do COMUNICA+.
 *
 * Neste MVP a implementação é um STUB DETERMINÍSTICO local (sem chave de API,
 * roda offline). Ela cumpre os quatro papéis descritos no conceito:
 *   1. transcrição   -> normaliza o texto vindo do reconhecimento de fala
 *   2. palavras-chave -> indexação para busca
 *   3. prioridade    -> classificação sugerida (estilo triagem)
 *   4. resumo        -> bullets do que foi dito
 *   5. ocorrência    -> detecta intercorrências para o Livro de Ocorrências
 *
 * A interface `analyze()` é o ponto de extensão: basta trocar o corpo por
 * chamadas a Whisper (diarização) + LLM (resumo/classificação/embeddings)
 * sem alterar o restante do sistema.
 */
@Injectable()
export class AiService {
  /** Palavras muito frequentes que não ajudam a indexar (PT-BR). */
  private static readonly STOPWORDS = new Set([
    'a','o','os','as','um','uma','uns','umas','de','do','da','dos','das','em','no','na','nos','nas',
    'e','ou','que','com','por','para','pra','pro','se','ao','aos','à','às','the',
    'foi','ser','está','estão','estamos','estou','tem','têm','há','vai','vou','já','não','sim',
    'isso','isto','aquele','aquela','este','esta','esse','essa','ele','ela','eles','elas','eu','nós',
    'meu','minha','seu','sua','nosso','nossa','muito','pouco','mais','menos','também','então','aqui',
    'ali','lá','como','quando','onde','porque','pois','mas','porém','até','sobre','entre','sem','só',
  ]);

  /** Termos que elevam a prioridade sugerida (triagem simples por regras). */
  private static readonly PRIORITY_TERMS: Array<{ terms: string[]; priority: Priority }> = [
    {
      priority: Priority.EMERGENCIA,
      terms: ['parada', 'pcr', 'reanimação', 'código azul', 'óbito', 'obito', 'incêndio', 'incendio',
        'evacuação', 'evacuacao', 'emergência', 'emergencia', 'grave', 'crítico', 'critico', 'risco de vida'],
    },
    {
      priority: Priority.URGENTE,
      terms: ['falta', 'faltando', 'sem oxigênio', 'sem oxigenio', 'oxigênio', 'oxigenio', 'parou',
        'suspend', 'suspensa', 'suspenso', 'quebrou', 'quebrada', 'pane', 'urgente', 'imediato',
        'imediatamente', 'sem energia', 'lotad', 'superlotação', 'superlotacao'],
    },
    {
      priority: Priority.IMPORTANTE,
      terms: ['atraso', 'atrasada', 'pendente', 'aguardando', 'transferência', 'transferencia',
        'agendar', 'reagendar', 'importante', 'atenção', 'atencao'],
    },
  ];

  /** Gatilhos que caracterizam uma intercorrência (Livro de Ocorrências). */
  private static readonly OCCURRENCE_TRIGGERS = [
    'parou', 'quebrou', 'quebrada', 'pane', 'falha', 'falta', 'faltando', 'suspend', 'suspensa',
    'suspenso', 'sem oxigênio', 'sem oxigenio', 'sem energia', 'incidente', 'intercorrência',
    'intercorrencia', 'acionamos', 'acionar', 'evacuação', 'evacuacao', 'parada', 'atraso',
    'superlotação', 'superlotacao', 'lotad',
  ];

  /**
   * Executa o pipeline completo sobre a transcrição bruta e o contexto.
   * `rawTranscript` vem do reconhecimento de fala do cliente (Web Speech API).
   */
  analyze(rawTranscript: string, sector: Sector, userPriority: Priority): AiAnalysis {
    const transcript = this.normalizeTranscript(rawTranscript);
    const keywords = this.extractKeywords(transcript);
    const suggestedPriority = this.classifyPriority(transcript, userPriority);
    const summary = this.summarize(transcript, sector);
    const occurrence = this.detectOccurrence(transcript, sector, keywords);
    return { transcript, summary, keywords, suggestedPriority, occurrence };
  }

  private normalizeTranscript(raw: string): string {
    const text = (raw || '').replace(/\s+/g, ' ').trim();
    if (!text) return '[sem transcrição — áudio sem fala reconhecida]';
    // Primeira letra maiúscula e ponto final.
    const capitalized = text.charAt(0).toUpperCase() + text.slice(1);
    return /[.!?]$/.test(capitalized) ? capitalized : capitalized + '.';
  }

  private tokenize(text: string): string[] {
    return this.stripAccents(text.toLowerCase())
      .replace(/[^a-z0-9\sáàâãéêíóôõúç]/gi, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  private stripAccents(s: string): string {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  /** Extrai palavras-chave por frequência, ignorando stopwords e tokens curtos. */
  extractKeywords(text: string, limit = 8): string[] {
    const freq = new Map<string, number>();
    for (const token of this.tokenize(text)) {
      if (token.length < 4) continue;
      if (AiService.STOPWORDS.has(token)) continue;
      if (/^\d+$/.test(token)) continue;
      freq.set(token, (freq.get(token) || 0) + 1);
    }
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([term]) => term);
  }

  /**
   * Prioridade final = a mais crítica entre a escolhida pelo usuário e a
   * inferida do conteúdo. A IA nunca rebaixa o que o humano marcou.
   */
  classifyPriority(text: string, userPriority: Priority): Priority {
    const haystack = this.stripAccents(text.toLowerCase());
    let inferred = Priority.ROTINA;
    for (const { terms, priority } of AiService.PRIORITY_TERMS) {
      if (terms.some((t) => haystack.includes(this.stripAccents(t)))) {
        inferred = priority;
        break; // regras já estão em ordem decrescente de criticidade
      }
    }
    const weight = { rotina: 0, importante: 1, urgente: 2, emergencia: 3 } as const;
    return weight[inferred] >= weight[userPriority] ? inferred : userPriority;
  }

  /** Resumo em bullets: escolhe as frases mais informativas. */
  summarize(text: string, sector: Sector): string {
    if (text.startsWith('[sem transcrição')) {
      return `• Transmissão de ${SECTOR_LABELS[sector]} sem fala reconhecida.`;
    }
    const sentences = text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (sentences.length <= 1) {
      return `• ${sentences[0] || text}`;
    }

    // Pontua cada frase pela densidade de palavras-chave.
    const keywordSet = new Set(this.extractKeywords(text, 12));
    const scored = sentences.map((s, i) => {
      const tokens = this.tokenize(s);
      const hits = tokens.filter((t) => keywordSet.has(t)).length;
      return { s, i, score: hits + (i === 0 ? 0.5 : 0) };
    });
    const top = scored
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .sort((a, b) => a.i - b.i);

    const chosen = (top.length ? top : scored.slice(0, 2)).map((x) => x.s);
    return chosen.map((s) => `• ${s.replace(/[.!?]+$/, '')}`).join('\n');
  }

  /** Detecta se a transmissão deve virar uma ocorrência estruturada. */
  detectOccurrence(text: string, sector: Sector, keywords: string[]) {
    const haystack = this.stripAccents(text.toLowerCase());
    const isOccurrence = AiService.OCCURRENCE_TRIGGERS.some((t) =>
      haystack.includes(this.stripAccents(t)),
    );

    // Título curto: primeira frase resumida.
    const firstSentence = text.split(/(?<=[.!?])\s+/)[0]?.replace(/[.!?]+$/, '') || text;
    const title = firstSentence.length > 80 ? firstSentence.slice(0, 77) + '…' : firstSentence;

    // "Responsável informado": procura menções a acionamento/comunicação.
    let responsible: string | null = null;
    const respMatch = haystack.match(/acion\w*\s+([a-zçãõáéíóúâêô ]{3,30})/);
    if (respMatch) responsible = respMatch[1].trim();
    else if (/manutenção|manutencao/.test(haystack)) responsible = 'Manutenção';
    else if (/engenharia/.test(haystack)) responsible = 'Engenharia Clínica';

    return {
      isOccurrence,
      category: this.categorize(sector, keywords),
      title,
      responsible,
    };
  }

  private categorize(sector: Sector, keywords: string[]): string {
    const base = SECTOR_LABELS[sector];
    const kw = keywords.map((k) => this.stripAccents(k));
    if (kw.some((k) => ['autoclave', 'esterilizacao', 'esterilização'].includes(k))) {
      return `${base} / CME`;
    }
    if (kw.some((k) => ['oxigenio', 'gases', 'energia', 'gerador'].includes(k))) {
      return `${base} / Infraestrutura`;
    }
    if (kw.some((k) => ['anestesista', 'cirurgia', 'sala'].includes(k))) {
      return `${base} / Assistencial`;
    }
    return base;
  }
}
