import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ClipboardList, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { ehCaminhoDeTarefa, caminhoDaTarefa } from '@/lib/linkDaTarefa';

/**
 * /tarefa/:taskId — o link próprio de uma tarefa. Descobre em que projeto ela está e abre o
 * detalhe lá. Fica atrás do login (rota privada) e das mesmas permissões da tela de projetos.
 */
type Estado = { tipo: 'procurando' } | { tipo: 'nao_encontrada' } | { tipo: 'excluida'; projectId: string } | { tipo: 'erro' };

export default function AbrirTarefa() {
  const { taskId = '' } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const [estado, setEstado] = useState<Estado>({ tipo: 'procurando' });
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let vivo = true;
    setEstado({ tipo: 'procurando' });
    if (!ehCaminhoDeTarefa(caminhoDaTarefa(taskId))) { setEstado({ tipo: 'nao_encontrada' }); return; }
    (async () => {
      const { data, error } = await supabase.from('project_tasks').select('id, project_id, deleted_at').eq('id', taskId).maybeSingle();
      if (!vivo) return;
      if (error) { setEstado({ tipo: 'erro' }); return; }
      const t = data as { project_id: string; deleted_at: string | null } | null;
      if (!t) { setEstado({ tipo: 'nao_encontrada' }); return; }
      if (t.deleted_at) { setEstado({ tipo: 'excluida', projectId: t.project_id }); return; }
      // replace: o "voltar" do navegador não volta para esta tela de passagem.
      navigate(`/producao/projetos?projectId=${t.project_id}&taskId=${taskId}`, { replace: true });
    })();
    return () => { vivo = false; };
  }, [taskId, tentativa, navigate]);

  const mensagens = {
    nao_encontrada: ['Tarefa não encontrada.', 'O link pode estar incompleto, ou a tarefa não existe mais.'],
    excluida: ['Essa tarefa foi excluída.', 'Ela está na lixeira do projeto, de onde pode ser restaurada.'],
    erro: ['Não foi possível abrir a tarefa.', 'Confira sua conexão e tente de novo.'],
  } as const;

  return (
    <div className="min-h-[60vh] text-lumos-text-primary flex items-center justify-center p-6">
      {estado.tipo === 'procurando' ? (
        <p className="flex items-center gap-2 text-sm text-lumos-text-secondary"><Loader2 className="w-5 h-5 animate-spin" /> Abrindo a tarefa…</p>
      ) : (
        <div className="card p-8 text-center max-w-sm w-full">
          <ClipboardList className="w-8 h-8 text-lumos-text-secondary/40 mx-auto mb-3" />
          <p className="text-sm font-bold">{mensagens[estado.tipo][0]}</p>
          <p className="text-xs text-lumos-text-secondary mt-1">{mensagens[estado.tipo][1]}</p>
          <div className="mt-4 flex items-center justify-center gap-3">
            {estado.tipo === 'erro' && <button type="button" onClick={() => setTentativa(n => n + 1)} className="btn-primary h-9 px-4 text-xs font-black">Tentar de novo</button>}
            {estado.tipo === 'excluida' && <button type="button" onClick={() => navigate(`/producao/projetos?projectId=${estado.projectId}&tab=tarefas`, { replace: true })} className="btn-primary h-9 px-4 text-xs font-black">Abrir o projeto</button>}
            <button type="button" onClick={() => navigate('/', { replace: true })} className="text-xs font-bold text-lumos-text-secondary hover:text-lumos-text-primary">Ir para o início</button>
          </div>
        </div>
      )}
    </div>
  );
}
