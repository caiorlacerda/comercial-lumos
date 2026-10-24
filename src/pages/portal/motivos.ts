// Textos que o cliente lê: estados, marcos e motivos de recusa. Movido de PortalCliente.tsx sem alterar.

/** Como o cliente lê o estado de um vídeo. Etapa interna nunca chega aqui. */
export const ESTADO: Record<string, { label: string; classe: string }> = {
  EM_REVISAO_CLIENTE: { label: 'Esperando você', classe: 's-voce' },
  APROVADO: { label: 'Aprovado por você', classe: 's-ok' },
  ALTERACOES_CLIENTE: { label: 'Ajustes pedidos', classe: 's-aj' },
};

export const MARCOS = [
  { chave: 'roteiro', label: 'Roteiro', status: ['roteiro'] },
  { chave: 'captacao', label: 'Captação', status: ['captacao'] },
  { chave: 'edicao', label: 'Edição', status: ['em_progresso'] },
  { chave: 'revisao', label: 'Sua revisão', status: ['revisao_interna', 'revisao_cliente', 'alteracoes'] },
  { chave: 'entrega', label: 'Entrega final', status: ['concluido', 'entregue'] },
];

/** Como o cliente lê o estado de um pedido de diária. */
export const ESTADO_PEDIDO: Record<string, { label: string; classe: string }> = {
  pendente: { label: 'Esperando a Lumos', classe: 's-prod' },
  aceito: { label: 'Aceito', classe: 's-ok' },
  recusado: { label: 'Recusado', classe: 's-aj' },
  cancelado: { label: 'Cancelado', classe: 's-prod' },
};

/** Motivo de recusa de `portal_pedir_diaria` e `portal_cancelar_pedido`, em
 *  português direto. Código que a função não devolve nunca (ou que a IA não
 *  previu) cai no genérico: botão que não responde é pior que aviso vago. */
export const MOTIVOS: Record<string, string> = {
  cedo: 'Esta data é cedo demais. Escolha um dia com mais folga.',
  dia_ocupado: 'Este dia acabou de ser ocupado. Escolha outro.',
  dia_bloqueado: 'Este dia não está disponível.',
  // O código do erro continua o mesmo; o que o cliente lê é que não explica a
  // razão, igual a qualquer outro dia indisponível.
  dia_semana_fechado: 'Este dia não está disponível. Escolha outro.',
  repetido: 'Você já tem um pedido em aberto para este dia.',
  sem_descricao: 'Conte o que precisa gravar.',
  sem_nome: 'Diga seu nome e seu e-mail.',
  sem_acesso: 'Este projeto não está disponível para você.',
  data_invalida: 'Escolha uma data dentro do próximo ano.',
  duracao_invalida: 'A duração precisa ficar entre 30 minutos e 24 horas.',
  texto_longo: 'Algum campo ficou longo demais. Resuma e tente de novo.',
  email_invalido: 'Esse e-mail não parece certo. Confira e tente de novo.',
  muitos_pedidos: 'Você já tem muitos pedidos em aberto. Fale com a produção da Lumos.',
};
export const MOTIVO_GENERICO = 'Não foi possível fazer isso agora. Tente de novo em instantes.';
export const motivoPedido = (erro: string) => MOTIVOS[erro] || MOTIVO_GENERICO;
/** Cancelar tem seu próprio `sem_acesso`: aqui não é "projeto indisponível",
 *  é "este pedido não é seu" (portal com login, pedido de outra pessoa). */
export const motivoCancelar = (erro: string) =>
  erro === 'sem_acesso' ? 'Este pedido é de outra pessoa.' : (MOTIVOS[erro] || MOTIVO_GENERICO);

/** `portal_agenda` também devolve `error`, e não tem as chaves de `Agenda`
 *  quando devolve: sem tratar, `agenda?.dias` etc. quebram o render (tela
 *  branca). O caso mais comum é sessão vencida num portal com login. */
export const motivoAgenda = (erro: string, exigeLogin: boolean) => {
  if (erro === 'invalid') return 'Este link não está mais ativo. Fale com quem te mandou o link.';
  if (erro === 'sem_acesso') {
    return exigeLogin
      ? 'Sua sessão expirou. Entre de novo para ver as diárias deste projeto.'
      : 'Este projeto não está disponível para diárias agora.';
  }
  return MOTIVO_GENERICO;
};
