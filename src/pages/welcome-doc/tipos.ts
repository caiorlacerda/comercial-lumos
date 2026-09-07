export type TipoSecao =
  | 'lead' | 'rows' | 'two-panels' | 'steps' | 'checklist'
  | 'note' | 'tips' | 'date-cards' | 'next-steps';

interface SecaoBase { key: string; type: TipoSecao }

export interface LeadSecao extends SecaoBase { type: 'lead'; body: string }

export interface RowsSecao extends SecaoBase {
  type: 'rows'; kicker: string; title: string; titleAccent?: string;
  rows: { name: string; role: string; when: string; pill?: string; pillStyle?: 'accent' | 'ghost' | 'green' }[];
  footnote?: string;
}

// esquerda é sempre o lado "incluído" (marcador cheio); direita é sempre o
// lado "fora do combinado" (marcador ×, texto apagado) — mesma convenção
// visual do mockup, fixada no componente em vez de virar mais uma opção.
export interface TwoPanelsSecao extends SecaoBase {
  type: 'two-panels'; kicker: string; title: string; titleAccent?: string;
  esquerda: { titulo: string; sub: string; itens: string[] };
  direita: { titulo: string; sub: string; itens: string[] };
}

export interface StepsSecao extends SecaoBase {
  type: 'steps'; kicker: string; title: string; titleAccent?: string; lead?: string;
  passos: { numero: string; texto: string; quemFaz: string; quando: string; suaVez?: boolean }[];
}

export interface ChecklistSecao extends SecaoBase { type: 'checklist' }

// `body` pode ter parágrafos separados por linha em branco (\n\n) — cada um
// vira um <p>. Nunca HTML: sem negrito nem link dentro do texto, por
// desenho (o spec proíbe render de HTML vindo do JSON).
export interface NoteSecao extends SecaoBase { type: 'note'; kicker: string; label: string; body: string }

export interface TipsSecao extends SecaoBase {
  type: 'tips'; kicker: string; title: string; titleAccent?: string;
  dicas: { titulo: string; texto: string }[];
}

export interface DateCardsSecao extends SecaoBase {
  type: 'date-cards'; kicker: string; title: string; titleAccent?: string;
  cards: { data: string; titulo: string; nota?: string; destaque?: boolean }[];
}

export interface NextStepsSecao extends SecaoBase {
  type: 'next-steps'; kicker: string; title: string; titleAccent?: string;
  passos: { numero: string; texto: string; nota?: string; quando: string }[];
}

export type Secao =
  | LeadSecao | RowsSecao | TwoPanelsSecao | StepsSecao | ChecklistSecao
  | NoteSecao | TipsSecao | DateCardsSecao | NextStepsSecao;
