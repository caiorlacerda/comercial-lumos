// Classificação dos status de tarefa (project_tasks) em grupos.
// Mantém os status usados no board (Projetos.tsx) + legados do schema base.

// 6 status atuais (+ pausado). Os legados continuam aqui por compatibilidade
// com dados antigos até a migração converter tudo.
export const TASK_DONE = ['concluido', 'entregue'];
export const TASK_ACTIVE = [
  'em_progresso', 'revisao_interna', 'revisao_cliente', 'alteracoes',
  'aprov_interna', 'em_andamento', // legados
];
export const TASK_TODO = [
  'na_fila', 'pausado',
  'iniciar', 'aguard_captacao', 'aguard_material', 'a_fazer', // legados
];

export const TASK_LABELS: Record<string, string> = {
  // atuais
  na_fila: 'Na fila', em_progresso: 'Em andamento', revisao_interna: 'Revisão interna',
  revisao_cliente: 'Com o cliente', alteracoes: 'Ajustes', concluido: 'Concluído',
  pausado: 'Pausado',
  // legados (mapeados para o texto novo)
  iniciar: 'Na fila', aguard_captacao: 'Na fila', aguard_material: 'Na fila', a_fazer: 'Na fila',
  em_andamento: 'Em andamento', aprov_interna: 'Revisão interna', entregue: 'Concluído',
};

export const taskLabel = (s?: string | null) => (s ? TASK_LABELS[s] || s : '—');
export const isDone = (s?: string | null) => !!s && TASK_DONE.includes(s);
export const isActive = (s?: string | null) => !!s && TASK_ACTIVE.includes(s);
export const isTodo = (s?: string | null) => !!s && TASK_TODO.includes(s);
// "Aberta" = tudo que não está concluído.
export const isOpen = (s?: string | null) => !isDone(s);
