/**
 * ETAPAS DO ROTEIRO — mesmo vocabulário das tarefas.
 *
 * O roteiro tinha um conjunto próprio de status ("em criação / em revisão /
 * aprovado") enquanto a tarefa falava outra língua ("na fila / revisão interna
 * / com o cliente / ajustes / aprovado"). Duas línguas para o mesmo fluxo é
 * como nasce a dúvida: "em revisão" do roteiro era a revisão interna ou a do
 * cliente? Ninguém sabia sem perguntar.
 *
 * Aqui as etapas seguem as da tarefa, nos nomes E nas cores, tirando as que não
 * existem no texto (captação e edição são do vídeo). Assim o mesmo chip
 * significa a mesma coisa em qualquer lugar do app.
 *
 * Uma lista só, usada pela aba Roteiros e pelo bloco dentro da tarefa: dois
 * mapas iguais viram dois mapas diferentes na primeira mudança.
 */

export interface EtapaRoteiro { value: string; label: string; chip: string }

export const ROTEIRO_STATUS: EtapaRoteiro[] = [
  { value: 'na_fila', label: 'Na fila', chip: 'bg-slate-500/15 text-slate-400 border-slate-500/40' },
  // O equivalente de "Edição" no vídeo: alguém está escrevendo agora.
  { value: 'em_criacao', label: 'Em criação', chip: 'bg-orange-500/15 text-orange-400 border-orange-500/40' },
  { value: 'revisao_interna', label: 'Revisão interna', chip: 'bg-purple-500/15 text-purple-400 border-purple-500/40' },
  { value: 'revisao_cliente', label: 'Com o cliente', chip: 'bg-amber-500/15 text-amber-500 border-amber-500/40' },
  // "Ajustes" é o que avisa que precisa de uma nova versão do texto.
  { value: 'ajustes', label: 'Ajustes', chip: 'bg-red-500/15 text-red-400 border-red-500/40' },
  { value: 'aprovado', label: 'Aprovado', chip: 'bg-green-600/15 text-green-500 border-green-600/40' },
];

const PADRAO = ROTEIRO_STATUS[1]; // Em criação

/** 'revisao' é o nome antigo, de antes de separar interna e cliente. */
export const etapaRoteiro = (status?: string | null): EtapaRoteiro =>
  ROTEIRO_STATUS.find(e => e.value === status)
  ?? (status === 'revisao' ? ROTEIRO_STATUS[2] : PADRAO);

export const OPCOES_ROTEIRO = ROTEIRO_STATUS.map(({ value, label }) => ({ value, label }));
