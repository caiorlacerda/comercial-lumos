// Classificação dos status de tarefa (project_tasks) em grupos.
// Mantém os status usados no board (Projetos.tsx) + legados do schema base.

// Pipeline da Lumos: 8 etapas do fluxo + Pausado. Os legados seguem mapeados
// por segurança (a migração 2026092000 já converteu os dados).
export const TASK_DONE = ['concluido', 'entregue'];
export const TASK_ACTIVE = [
  'roteiro', 'captacao', 'em_progresso', 'revisao_interna', 'revisao_cliente', 'alteracoes',
  'aprov_interna', 'em_andamento', // legados
];
export const TASK_TODO = [
  'na_fila', 'pausado',
  'iniciar', 'aguard_captacao', 'aguard_material', 'a_fazer', // legados
];

export const TASK_LABELS: Record<string, string> = {
  // etapas atuais (ordem do fluxo)
  na_fila: 'Na fila', roteiro: 'Roteiro', captacao: 'Captação', em_progresso: 'Edição',
  revisao_interna: 'Revisão interna', revisao_cliente: 'Com o cliente', alteracoes: 'Ajustes',
  concluido: 'Aprovado', pausado: 'Pausado',
  // legados (mapeados para o texto novo)
  iniciar: 'Na fila', aguard_material: 'Na fila', a_fazer: 'Na fila',
  aguard_captacao: 'Captação', em_andamento: 'Edição',
  aprov_interna: 'Com o cliente', entregue: 'Aprovado',
};

export const taskLabel = (s?: string | null) => (s ? TASK_LABELS[s] || s : '—');
export const isDone = (s?: string | null) => !!s && TASK_DONE.includes(s);
export const isActive = (s?: string | null) => !!s && TASK_ACTIVE.includes(s);
export const isTodo = (s?: string | null) => !!s && TASK_TODO.includes(s);
// "Aberta" = tudo que não está concluído.
export const isOpen = (s?: string | null) => !isDone(s);
