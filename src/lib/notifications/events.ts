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
  PROJETO_FINANCEIRO_ENCERRADO: { key: 'projeto_financeiro_encerrado', category: 'financeiro', label: 'Projeto encerrado no financeiro (e o que falta receber)', defaultEnabled: true, priority: 'high' },
  NOTA_FISCAL_RECEBIDA: { key: 'nota_fiscal_recebida', category: 'financeiro', label: 'Fornecedor enviou nota fiscal', defaultEnabled: true, priority: 'high' },

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
  VIDEO_APROVADO_CLIENTE: { key: 'video_aprovado_cliente', category: 'producao', label: 'Cliente aprovou um vídeo', defaultEnabled: true, priority: 'high' },
  VIDEO_AJUSTES_CLIENTE: { key: 'video_ajustes_cliente', category: 'producao', label: 'Cliente pediu ajustes num vídeo', defaultEnabled: true, priority: 'high' },
  VIDEO_NOVO: { key: 'video_novo', category: 'producao', label: 'Vídeo novo (ou nova versão) entrou na revisão', defaultEnabled: true },
  TAREFA_MUDOU_ETAPA: { key: 'tarefa_mudou_etapa', category: 'producao', label: 'Uma tarefa sua mudou de etapa', defaultEnabled: true },
  CLIENTE_ABRIU_LINK: { key: 'cliente_abriu_link', category: 'producao', label: 'Cliente abriu o link de revisão', defaultEnabled: true },
  VIDEO_COM_CLIENTE: { key: 'video_com_cliente', category: 'producao', label: 'Vídeo foi para a revisão do cliente (atendimento do projeto)', defaultEnabled: true, priority: 'high' },
  DIARIA_SOLICITADA: { key: 'diaria_solicitada', category: 'producao', label: 'Cliente pediu uma diária pelo portal', defaultEnabled: true, priority: 'high' },
  BOAS_VINDAS_ITEM_ENVIADO: { key: 'boas_vindas_item_enviado', category: 'producao', label: 'Cliente enviou material do Bem-vindo à Lumos', defaultEnabled: true, priority: 'normal' },

  // COMERCIAL
  ORCAMENTO_CRIADO: { key: 'orcamento_criado', category: 'comercial', label: 'Novo orçamento criado', defaultEnabled: false },
  ORCAMENTO_APROVADO: { key: 'orcamento_aprovado', category: 'comercial', label: 'Orçamento aprovado pelo cliente', defaultEnabled: true, priority: 'high' },
  ORCAMENTO_SEM_RESPOSTA_7D: { key: 'orcamento_sem_resposta_7d', category: 'comercial', label: 'Orçamento sem resposta há 7 dias', defaultEnabled: true },

  // SISTEMA
  NOVO_USUARIO_ACESSO: { key: 'novo_usuario_acesso', category: 'sistema', label: 'Novo usuário concluiu o cadastro (admin)', defaultEnabled: true, adminOnly: true, priority: 'high' },
  PERMISSAO_ALTERADA: { key: 'permissao_alterada', category: 'sistema', label: 'Suas permissões foram alteradas', defaultEnabled: true },
  COMUNICADO: { key: 'comunicado', category: 'sistema', label: 'Comunicados da administração', defaultEnabled: true, priority: 'high' },
} as const;

export type NotificationEventKey = typeof NOTIFICATION_EVENTS[keyof typeof NOTIFICATION_EVENTS]['key'];
export type NotificationEventDef = typeof NOTIFICATION_EVENTS[keyof typeof NOTIFICATION_EVENTS];
