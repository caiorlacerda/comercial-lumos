// Formatos que o portal recebe do banco. Movido de PortalCliente.tsx sem alterar.

export interface Entrega {
  file_name: string; versao: number; status: string;
  largura: number | null; altura: number | null;
  client_decision: string | null; client_decided_by: string | null; client_decided_at: string | null;
  entregue_em: string | null; review_token: string | null; allow_download: boolean;
}
export interface EscopoItem { rotulo: string; meta: number; realizado: number }
export interface FaseRaw { etapa: string; n: number; inicio: string | null; fim: string | null; prazo_cliente: string | null }
export interface Projeto {
  id: string; nome: string; code: string | null; status: string;
  data_inicio: string | null; data_fim: string | null;
  entregas: Entrega[]; cronograma: FaseRaw[]; stages: Record<string, number>;
  escopo: EscopoItem[]; arquivos: { name: string; url: string; kind: string }[];
}
export interface Portal {
  cliente: { nome: string };
  portal: { show_financeiro: boolean; blocks: Record<string, boolean>; exige_login?: boolean };
  /** Quem entrou, quando o portal exige login. Nome verificado, não digitado. */
  voce?: { nome: string; email: string } | null;
  abrir_projeto: string | null;
  projetos: Projeto[];
  contatos: { nome: string; email: string; cargo: string | null; foto: string | null; whatsapp: string | null; slack: string | null }[];
  financeiro: { em_dia: boolean; proximo_vencimento: string | null } | null;
  atividade: { tipo: string; projeto: string; file_name: string; decisao?: string; quem?: string; versao?: number; quando: string }[];
}

/** A agenda de diárias de um projeto: calendário, gravações marcadas, pacote
 *  do mês e os pedidos em aberto. Vem inteira de `portal_agenda`. */
export interface Agenda {
  antecedencia_dias: number;
  /** O dia diz o estado e nada mais. O porquê de um dia estar indisponível é
   *  assunto interno: `portal_agenda` parou de mandar `motivo` na migração
   *  2026093336, e a tela não pergunta por ele. */
  dias: { data: string; estado: 'livre' | 'ocupado' | 'bloqueado' | 'cedo' }[];
  /** `id`, `duracao_horas`, `descricao` e `equipe` só chegam depois da
   *  migração 2026093336; antes dela o cartão abre com data, horário e local,
   *  que é o que a função antiga manda. `equipe` só vem preenchida quando a
   *  Lumos autorizou este cliente (`client_portals.mostrar_equipe`): sem
   *  autorização a lista chega vazia do banco, e não há nada escondido na
   *  tela. De cada pessoa vêm só nome e função. */
  agendadas: {
    id?: string; nome: string; data: string; hora_inicio: string | null;
    hora_fim: string | null; local: string | null;
    duracao_horas?: number | null; descricao?: string | null;
    equipe?: { nome: string; funcao: string | null }[];
    /** A ordem do dia daquela gravação, só depois da migração 2026093337 e só
     *  quando a Lumos aprovou a ordem: rascunho não chega aqui. Vêm três
     *  coisas, e nada além delas. Horário de chamada de cada pessoa,
     *  equipamento, figurino, objetos, regras internas, contatos, talentos,
     *  locações, clima e a equipe da ordem não saem do banco. */
    ordem?: {
      ponto_encontro: { nome: string | null; endereco: string | null } | null;
      /** O minuto a minuto na ordem em que foi escrito: hora e o que
       *  acontece, nada mais. */
      cronograma: { hora: string | null; descricao: string | null }[] | null;
      nota_cliente: string | null;
    } | null;
  }[];
  /** O pacote do MÊS CORRENTE, do bloco "Suas diárias neste mês". */
  pacote: { meta: number; realizado: number } | null;
  /** O pacote de cada mês que o calendário alcança, com a chave em 'AAAA-MM'.
   *  O aviso de diária extra tem que ler o mês da data escolhida, que é o mesmo
   *  mês que `portal_pedir_diaria` usa pra gravar `fora_do_pacote`. Mês sem
   *  contrato por volume não entra no mapa. Opcional porque só existe depois da
   *  migração 2026093333. */
  pacotes?: Record<string, { meta: number; realizado: number }>;
  pedidos: { id: string; data_desejada: string; estado: string; motivo_recusa: string | null; fora_do_pacote: boolean; descricao: string }[];
}

/** Uma gravação marcada, do jeito que o cartão e a janela dela leem. */
export type Gravacao = Agenda['agendadas'][number];

/** As quatro abas de dentro de um projeto. */
export type AbaProjeto = 'geral' | 'entregas' | 'diarias' | 'arquivos';
export const ABAS_PROJETO: readonly AbaProjeto[] = ['geral', 'entregas', 'diarias', 'arquivos'];

/** Como o projeto anda frente ao prazo, na leitura do cliente. */
export type EstadoSaude = 'no_prazo' | 'atencao' | 'atrasado';
export interface ItemPendencia { id: string; texto: string; prazo: string | null }
/** O que `portal_visao_projetos` devolve de cada projeto. */
export interface VisaoProjeto {
  id: string;
  saude: { estado: EstadoSaude } | null;
  pendencias: ItemPendencia[];
  equipe: { nome: string; funcao: string | null; foto: string | null }[];
}
export interface VisaoProjetos {
  projetos: VisaoProjeto[];
  pendencias_cliente: ItemPendencia[];
  boas_vindas_pendentes: { chave: string; titulo: string }[];
}
