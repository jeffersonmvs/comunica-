/**
 * Segredo de assinatura do JWT. Em produção, defina JWT_SECRET no ambiente.
 * O valor padrão serve apenas para desenvolvimento/demonstração.
 */
export const JWT_SECRET = process.env.JWT_SECRET || 'comunica-plus-dev-secret-change-me';
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';

/** Payload assinado no token. */
export interface JwtPayload {
  sub: string; // userId
  name: string;
  sector: string;
  role: string;
}
