/**
 * Domínio compartilhado do COMUNICA+.
 *
 * Estes enums modelam o vocabulário operacional descrito no conceito:
 * setores hospitalares, níveis de prioridade (estilo radiocomunicação
 * profissional) e o ciclo de vida do "Livro de Ocorrências Inteligente".
 */

/** Papéis/setores da gestão hospitalar (público-alvo do sistema). */
export enum Sector {
  DIRETOR_GERAL = 'diretor_geral',
  DIRETOR_CLINICO = 'diretor_clinico',
  DIRETOR_TECNICO = 'diretor_tecnico',
  EMERGENCIA = 'emergencia',
  CENTRO_CIRURGICO = 'centro_cirurgico',
  UTI = 'uti',
  ENFERMAGEM = 'enfermagem',
  OBSTETRICIA = 'obstetricia',
  PEDIATRIA = 'pediatria',
  ENGENHARIA_CLINICA = 'engenharia_clinica',
  FARMACIA = 'farmacia',
  CME = 'cme',
  HOTELARIA = 'hotelaria',
  SEGURANCA = 'seguranca',
  MANUTENCAO = 'manutencao',
}

/** Rótulos legíveis para exibição (PT-BR). */
export const SECTOR_LABELS: Record<Sector, string> = {
  [Sector.DIRETOR_GERAL]: 'Diretor Geral',
  [Sector.DIRETOR_CLINICO]: 'Diretor Clínico',
  [Sector.DIRETOR_TECNICO]: 'Diretor Técnico',
  [Sector.EMERGENCIA]: 'Coordenador da Emergência',
  [Sector.CENTRO_CIRURGICO]: 'Coordenador do Centro Cirúrgico',
  [Sector.UTI]: 'Coordenador da UTI',
  [Sector.ENFERMAGEM]: 'Coordenador da Enfermagem',
  [Sector.OBSTETRICIA]: 'Coordenação Obstétrica',
  [Sector.PEDIATRIA]: 'Coordenação Pediátrica',
  [Sector.ENGENHARIA_CLINICA]: 'Engenharia Clínica',
  [Sector.FARMACIA]: 'Farmácia',
  [Sector.CME]: 'CME',
  [Sector.HOTELARIA]: 'Hotelaria',
  [Sector.SEGURANCA]: 'Segurança',
  [Sector.MANUTENCAO]: 'Manutenção',
};

/**
 * Prioridade estilo rádio profissional.
 * Emergência (vermelho) pode interromper transmissões não críticas.
 */
export enum Priority {
  ROTINA = 'rotina', // 🟢
  IMPORTANTE = 'importante', // 🟡
  URGENTE = 'urgente', // 🟠
  EMERGENCIA = 'emergencia', // 🔴
}

/** Peso numérico usado para decidir interrupções (maior = mais crítico). */
export const PRIORITY_WEIGHT: Record<Priority, number> = {
  [Priority.ROTINA]: 0,
  [Priority.IMPORTANTE]: 1,
  [Priority.URGENTE]: 2,
  [Priority.EMERGENCIA]: 3,
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  [Priority.ROTINA]: 'Rotina',
  [Priority.IMPORTANTE]: 'Importante',
  [Priority.URGENTE]: 'Urgente',
  [Priority.EMERGENCIA]: 'Emergência',
};

/** Ciclo de vida de uma ocorrência no Livro de Ocorrências Inteligente. */
export enum OccurrenceStatus {
  ABERTO = 'aberto',
  EM_ANDAMENTO = 'em_andamento',
  RESOLVIDO = 'resolvido',
}

export const OCCURRENCE_STATUS_LABELS: Record<OccurrenceStatus, string> = {
  [OccurrenceStatus.ABERTO]: 'Aberto',
  [OccurrenceStatus.EM_ANDAMENTO]: 'Em andamento',
  [OccurrenceStatus.RESOLVIDO]: 'Resolvido',
};

/** Tipo de confirmação de uma transmissão (rastreabilidade). */
export enum ReceiptType {
  RECEBIDO = 'recebido',
  ESCUTADO = 'escutado',
}

/**
 * Papel de acesso (RBAC), independente do setor. O setor diz "de onde a pessoa
 * fala"; o papel diz "o que ela pode fazer" no sistema.
 */
export enum Role {
  ADMIN = 'admin', // administração do sistema (gestão de usuários)
  DIRETOR = 'diretor', // direção — acesso operacional total
  COORDENADOR = 'coordenador', // coordenadores de setor
  OPERADOR = 'operador', // demais operacionais
}

export const ROLE_LABELS: Record<Role, string> = {
  [Role.ADMIN]: 'Administrador',
  [Role.DIRETOR]: 'Direção',
  [Role.COORDENADOR]: 'Coordenador',
  [Role.OPERADOR]: 'Operador',
};

/** Hierarquia de papéis (maior = mais privilégios). */
export const ROLE_RANK: Record<Role, number> = {
  [Role.OPERADOR]: 0,
  [Role.COORDENADOR]: 1,
  [Role.DIRETOR]: 2,
  [Role.ADMIN]: 3,
};

/** Papel padrão sugerido para cada setor no cadastro. */
export function defaultRoleForSector(sector: Sector): Role {
  switch (sector) {
    case Sector.DIRETOR_GERAL:
    case Sector.DIRETOR_CLINICO:
    case Sector.DIRETOR_TECNICO:
      return Role.DIRETOR;
    case Sector.EMERGENCIA:
    case Sector.CENTRO_CIRURGICO:
    case Sector.UTI:
    case Sector.ENFERMAGEM:
    case Sector.OBSTETRICIA:
    case Sector.PEDIATRIA:
      return Role.COORDENADOR;
    default:
      return Role.OPERADOR;
  }
}

export function isSector(value: string): value is Sector {
  return (Object.values(Sector) as string[]).includes(value);
}

export function isRole(value: string): value is Role {
  return (Object.values(Role) as string[]).includes(value);
}

export function isPriority(value: string): value is Priority {
  return (Object.values(Priority) as string[]).includes(value);
}
