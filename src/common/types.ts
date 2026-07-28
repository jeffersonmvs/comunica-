import { OccurrenceStatus, Priority, ReceiptType, Role, Sector } from './enums';

export interface User {
  id: string;
  name: string;
  sector: Sector;
  role: Role;
  createdAt: string;
}

export interface Channel {
  id: string;
  key: string; // slug estável, ex.: "diretoria", "centro_cirurgico", "todos"
  name: string;
  description: string | null;
  createdAt: string;
}

/**
 * Registro permanente de UMA transmissão de voz (o coração do sistema).
 * Nada é perdido: áudio + transcrição + resumo + palavras-chave + metadados.
 */
export interface Transmission {
  id: string;
  channelId: string;
  channelKey: string;
  channelName: string;
  userId: string;
  userName: string;
  sector: Sector;
  priority: Priority;
  startedAt: string;
  durationMs: number;
  audioPath: string | null; // caminho relativo do blob de áudio
  mimeType: string | null;
  transcript: string;
  summary: string;
  keywords: string[];
  createdAt: string;
}

/** Uma entrada do Livro de Ocorrências Inteligente. */
export interface Occurrence {
  id: string;
  transmissionId: string | null;
  category: string;
  sector: Sector;
  priority: Priority;
  title: string;
  summary: string;
  responsible: string | null;
  status: OccurrenceStatus;
  openedAt: string;
  updatedAt: string;
  history: OccurrenceHistoryEntry[];
}

export interface OccurrenceHistoryEntry {
  at: string;
  status: OccurrenceStatus;
  note: string;
}

export interface Receipt {
  id: string;
  transmissionId: string;
  userId: string;
  userName: string;
  type: ReceiptType;
  at: string;
}

/** Resultado do pipeline de IA (stub determinístico neste MVP). */
export interface AiAnalysis {
  transcript: string;
  summary: string;
  keywords: string[];
  suggestedPriority: Priority;
  occurrence: {
    isOccurrence: boolean;
    category: string;
    title: string;
    responsible: string | null;
  };
}
