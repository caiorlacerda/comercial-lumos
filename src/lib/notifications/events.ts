export const NOTIFICATION_EVENTS = {
  // FINANCEIRO
  CONTA_VENCENDO_3D: { key: 'conta_vencendo_3d', category: 'financeiro', label: 'Conta a pagar vence em 3 dias', defaultEnabled: true },
  CONTA_VENCENDO_HOJE: { key: 'conta_vencendo_hoje', category: 'financeiro', label: 'Conta a pagar vence hoje', defaultEnabled: true, priority: 'high' },
  CONTA_ATRASADA: { key: 'conta_atrasada', category: 'financeiro', label: 'Conta a pagar atrasada', defaultEnabled: true, priority: 'urgent' },
  REEMBOLSO_APROVADO: { key: 'reembolso_aprovado', category: 'financeiro', label: 'Reembolso aprovado', defaultEnabled: true },
  REEMBOLSO_REJEITADO: { key: 'reembolso_rejeitado', category: 'financeiro', label: 'Reembolso rejeitado', defaultEnabled: true },
  REEMBOLSO_PENDENTE_APROVACAO: { key: 'reembolso_pendente_aprovacao', category: 'financeiro', label: 'Reembolso aguardando sua aprovação', defaultEnabled: true, priority: 'high' },
  PAGAMENTO_RECEBIDO: { key: 'pagamento_recebido', category: 'financeiro', label: 'Pagamento recebido', defaultEnabled: true },
  CUSTO_PROJETO_ESTOUROU: { key: 'custo_projeto_estourou', category: 'financeiro', label: 'Custo de projeto ultrapassou 90% do orçado', defaultEnabled: true, priority: 'high' },

  // PRODUÇÃO
  OS_ATRIBUIDA: { key: 'os_atribuida', category: 'producao', label: 'Nova OS atribuída a você', defaultEnabled: true },
  ORDEM_DIA_PUBLICADA: { key: 'ordem_dia_publicada', category: 'producao', label: 'Ordem do Dia publicada', defaultEnabled: true },
  TODO_ATRIBUIDO: { key: 'todo_atribuido', category: 'producao', label: 'Nova tarefa atribuída a você', defaultEnabled: true },
  FORNECEDOR_AUTOCADASTRO: { key: 'fornecedor_autocadastro', category: 'producao', label: 'Fornecedor preencheu cadastro público', defaultEnabled: true },
  MENTION_COMMENT: { key: 'mencao_comentario', category: 'producao', label: 'Menção em comentário', defaultEnabled: true },
  COMENTARIO_TAREFA: { key: 'comentario_tarefa', category: 'producao', label: 'Novo comentário na sua tarefa', defaultEnabled: true },
  PROJETO_ENCERRADO: { key: 'projeto_encerrado', category: 'producao', label: 'Projeto encerrado', defaultEnabled: true },
  NOVO_ACESSO_DISPONIVEL: { key: 'novo_acesso_disponivel', category: 'producao', label: 'Novo acesso/senha disponível pra você', defaultEnabled: true },
  DEADLINE_ALERT: { key: 'prazo_alerta', category: 'producao', label: 'Alerta de prazo de entrega', defaultEnabled: true },
  COMENTARIOS_CLIENTE_VIDEO: { key: 'comentarios_cliente_video', category: 'producao', label: 'Cliente comentou no seu vídeo (em lote, 30 min após o último)', defaultEnabled: true, priority: 'high' },

  // COMERCIAL
  ORCAMENTO_CRIADO: { key: 'orcamento_criado', category: 'comercial', label: 'Novo orçamento criado', defaultEnabled: false },
  ORCAMENTO_APROVADO: { key: 'orcamento_aprovado', category: 'comercial', label: 'Orçamento aprovado pelo cliente', defaultEnabled: true, priority: 'high' },
  ORCAMENTO_SEM_RESPOSTA_7D: { key: 'orcamento_sem_resposta_7d', category: 'comercial', label: 'Orçamento sem resposta há 7 dias', defaultEnabled: true },

  // SISTEMA
  NOVO_USUARIO_ACESSO: { key: 'novo_usuario_acesso', category: 'sistema', label: 'Novo usuário pediu acesso (admin)', defaultEnabled: true, adminOnly: true, priority: 'high' },
  PERMISSAO_ALTERADA: { key: 'permissao_alterada', category: 'sistema', label: 'Suas permissões foram alteradas', defaultEnabled: true },
  COMUNICADO: { key: 'comunicado', category: 'sistema', label: 'Comunicados da administração', defaultEnabled: true, priority: 'high' },
} as const;

export type NotificationEventKey = typeof NOTIFICATION_EVENTS[keyof typeof NOTIFICATION_EVENTS]['key'];
export type NotificationEventDef = typeof NOTIFICATION_EVENTS[keyof typeof NOTIFICATION_EVENTS];
