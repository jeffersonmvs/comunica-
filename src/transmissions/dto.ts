import { Priority } from '../common/enums';

export interface CreateTransmissionInput {
  channelId: string;
  userId: string;
  priority: Priority;
  /** Transcrição bruta do reconhecimento de fala do cliente (pode ser vazia). */
  transcript?: string;
  /** Áudio em base64 (com ou sem prefixo data:) — opcional. */
  audioBase64?: string;
  mimeType?: string;
  durationMs?: number;
  startedAt?: string;
}
