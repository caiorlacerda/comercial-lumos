import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { TASK_DONE } from '@/lib/taskStatus';
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch';
import type { CargaPessoa, DadosGestao, FilasGestao, ItemFila, VideoParado } from './tipos';

const DIAS_PARADO = 3;   // vídeo em revisão sem movimento há mais que isso aparece em "Vídeos parados"
const hoje = () => new Date().toLocaleDateString('en-CA');
const maisDias = (n: number) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA');
const diasDesde = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
const rotaProjeto = (projectId: string, taskId?: string | null) =>
  `/producao/projetos?projectId=${projectId}${taskId ? `&taskId=${taskId}` : ''}`;

interface Tarefa { id: string; project_id: string; titulo: string; status: string; data_fim: string | null; responsavel_id: string | null; project: { id: string; name: string } | null }
interface VideoVersao { id: string; group_id: string | null; versao: number; status: string; updated_at: string; file_name: string; project_id: string; task_id: string | null; project: { id: string; name: string } | null }

const VAZIO: DadosGestao = {
  carregando: true,
  saude: { projetosAtivos: 0, entregas7d: 0, comCliente: 0, atrasadas: 0, maisAntigaDias: 0 },
  filas: { aval: [], diarias: [], reservas: [], fornecedores: [], semResponsavel: [] },
  carga: { pessoas: [], semResponsavel: 0, max: 0 },
  parados: [],
  ociosos: [],
};

/**
 * Números da produção para a Home de quem gere o time. Usa as mesmas regras da Visão Geral da Produção
 * (tarefa aberta = fora de TASK_DONE, projeto ativo) e atualiza sozinho quando algo muda.
 * `ativo = false` (papel do time) não consulta nada.
 */
export function useGestaoHome(ativo: boolean): DadosGestao | undefined {
  const [dados, setDados] = useState<DadosGestao>(VAZIO);

  const carregar = useCallback(async () => {
    // allSettled: se uma tabela negar acesso ou falhar, as outras seções continuam funcionando
    const [proj, tar, usu, vid, dia, res, forn] = await Promise.allSettled([
      supabase.from('projects').select('id', { count: 'exact', head: true }).eq('status', 'ativo'),
      supabase.from('project_tasks')
        .select('id, project_id, titulo, status, data_fim, responsavel_id, project:projects!inner(id, name, status)')
        .eq('project.status', 'ativo').is('deleted_at', null),
      supabase.from('app_users').select('id, full_name, avatar_url, role, hidden').eq('status', 'ativo'),
      supabase.from('video_versions')
        .select('id, group_id, versao, status, updated_at, file_name, project_id, task_id, project:projects!inner(id, name, status)')
        .eq('project.status', 'ativo'),
      supabase.from('diaria_pedidos').select('id, nome, data_desejada, project_id').eq('estado', 'pendente').order('created_at', { ascending: true }),
      supabase.from('equipment_reservations')
        .select('id, start_date, end_date, equipment:equipment_id(name), requester:app_users!requested_by(full_name)')
        .eq('status', 'solicitada').order('created_at', { ascending: true }),
      supabase.from('fornecedores').select('id, nome').eq('status_cadastro', 'pendente').order('nome', { ascending: true }),
    ]);
    const lista = <T,>(r: PromiseSettledResult<any>): T[] => (r.status === 'fulfilled' && !r.value.error ? (r.value.data as T[]) || [] : []);

    const tarefas = lista<Tarefa>(tar);
    const abertas = tarefas.filter(t => !TASK_DONE.includes(t.status));
    const h = hoje();
    const limite = maisDias(7);

    // ── Saúde ─────────────────────────────────────────────────────────────
    const atrasadas = abertas.filter(t => t.data_fim && t.data_fim < h);
    const saude = {
      projetosAtivos: proj.status === 'fulfilled' ? (proj.value.count ?? 0) : 0,
      entregas7d: abertas.filter(t => t.data_fim && t.data_fim >= h && t.data_fim <= limite).length,
      comCliente: abertas.filter(t => t.status === 'revisao_cliente').length,
      atrasadas: atrasadas.length,
      maisAntigaDias: atrasadas.reduce((m, t) => Math.max(m, diasDesde(t.data_fim + 'T12:00:00')), 0),
    };

    // ── Carga por pessoa ──────────────────────────────────────────────────
    const usuarios = lista<{ id: string; full_name: string; avatar_url: string | null; role?: string; hidden?: boolean }>(usu);
    const porPessoa = new Map<string, { abertas: number; atrasadas: number }>();
    let semResp = 0;
    abertas.forEach(t => {
      if (!t.responsavel_id) { semResp++; return; }
      const e = porPessoa.get(t.responsavel_id) || { abertas: 0, atrasadas: 0 };
      e.abertas++;
      if (t.data_fim && t.data_fim < h) e.atrasadas++;
      porPessoa.set(t.responsavel_id, e);
    });
    const pessoas: CargaPessoa[] = [...porPessoa.entries()]
      .map(([id, v]) => {
        const u = usuarios.find(x => x.id === id);
        return { id, nome: u?.full_name || 'Usuário', avatar_url: u?.avatar_url ?? null, ...v };
      })
      .sort((a, b) => b.abertas - a.abertas)
      .slice(0, 6);

    const ociosos = usuarios
      .filter(u => !u.hidden && u.role !== 'admin' && !porPessoa.has(u.id))
      .map(u => ({ id: u.id, nome: u.full_name, avatar_url: u.avatar_url }))
      .sort((a, b) => a.nome.localeCompare(b.nome));

    // ── Vídeos: só vale a versão mais recente de cada vídeo ───────────────
    const maisRecente = new Map<string, VideoVersao>();
    lista<VideoVersao>(vid).forEach(v => {
      const k = v.group_id || v.id;
      const atual = maisRecente.get(k);
      if (!atual || v.versao > atual.versao) maisRecente.set(k, v);
    });
    const videos = [...maisRecente.values()];
    const aval: ItemFila[] = videos.filter(v => v.status === 'EM_REVISAO_INTERNA').map(v => ({
      id: v.id, titulo: v.file_name, sub: v.project?.name ?? undefined, rota: rotaProjeto(v.project_id, v.task_id),
    }));
    const parados: VideoParado[] = videos
      .filter(v => (v.status === 'EM_REVISAO_INTERNA' || v.status === 'EM_REVISAO_CLIENTE') && diasDesde(v.updated_at) >= DIAS_PARADO)
      .map(v => ({
        id: v.id, arquivo: v.file_name, projeto: v.project?.name ?? null, dias: diasDesde(v.updated_at), status: v.status,
        rota: rotaProjeto(v.project_id, v.task_id),
      }))
      .sort((a, b) => b.dias - a.dias)
      .slice(0, 5);

    // ── Filas que dependem de uma decisão ─────────────────────────────────
    const nomeProjeto = new Map<string, string>();
    tarefas.forEach(t => { if (t.project) nomeProjeto.set(t.project.id, t.project.name); });
    const filas: FilasGestao = {
      aval,
      diarias: lista<{ id: string; nome: string | null; data_desejada: string | null; project_id: string }>(dia).map(p => ({
        id: p.id, titulo: `Pedido de diária${p.nome ? ` de ${p.nome}` : ''}`,
        sub: nomeProjeto.get(p.project_id) ?? undefined, rota: rotaProjeto(p.project_id),
      })),
      reservas: lista<any>(res).map(r => ({
        id: r.id, titulo: r.equipment?.name || 'Equipamento', sub: r.requester?.full_name ? `pedido por ${r.requester.full_name}` : undefined,
        rota: '/producao/equipamentos',
      })),
      fornecedores: lista<{ id: string; nome: string }>(forn).map(f => ({ id: f.id, titulo: f.nome, rota: '/producao/fornecedores' })),
      semResponsavel: abertas.filter(t => !t.responsavel_id).map(t => ({
        id: t.id, titulo: t.titulo, sub: t.project?.name, rota: rotaProjeto(t.project_id, t.id),
      })),
    };

    setDados({ carregando: false, saude, filas, carga: { pessoas, semResponsavel: semResp, max: pessoas[0]?.abertas ?? 0 }, parados, ociosos });
  }, []);

  useEffect(() => { if (ativo) void carregar(); }, [ativo, carregar]);
  useRealtimeRefetch(['project_tasks', 'video_versions', 'diaria_pedidos', 'equipment_reservations', 'fornecedores'], () => { void carregar(); }, { enabled: ativo });

  return useMemo(() => (ativo ? dados : undefined), [ativo, dados]);
}
