// Classificação dos status de tarefa (project_tasks) em grupos.
// Mantém os status usados no board (Projetos.tsx) + legados do schema base.

export const TASK_DONE = ['entregue', 'concluido'];
export const TASK_ACTIVE = [
  'na_fila', 'em_progresso', 'revisao_interna', 'aprov_interna',
  'revisao_cliente', 'alteracoes', 'em_andamento',
];
export const TASK_TODO = ['iniciar', 'pausado', 'aguard_captacao', 'aguard_material', 'a_fazer'];

export const TASK_LABELS: Record<string, string> = {
  iniciar: 'Iniciar', pausado: 'Pausado', aguard_captacao: 'Aguard. Captação',
  aguard_material: 'Aguard. Material', a_fazer: 'A Fazer',
  na_fila: 'Na Fila', em_progresso: 'Em Progresso', em_andamento: 'Em Andamento',
  revisao_interna: 'Revisão Interna', aprov_interna: 'Aprov. Interna',
  revisao_cliente: 'Revisão do Cliente', alteracoes: 'Alterações',
  entregue: 'Entregue', concluido: 'Concluído',
};

export const taskLabel = (s?: string | null) => (s ? TASK_LABELS[s] || s : '—');
export const isDone = (s?: string | null) => !!s && TASK_DONE.includes(s);
export const isActive = (s?: string | null) => !!s && TASK_ACTIVE.includes(s);
export const isTodo = (s?: string | null) => !!s && TASK_TODO.includes(s);
// "Aberta" = tudo que não está concluído.
export const isOpen = (s?: string | null) => !isDone(s);
