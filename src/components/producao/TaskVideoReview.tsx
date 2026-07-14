import { useCallback, useEffect, useState } from 'react';
import { Film, MessageSquare, Play, Link2, Unlink, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import Select from '@/components/ui/Select';
import InternalReviewModal from './InternalReviewModal';
import { type ReviewStatus, STATUS_UI, taskStatusToVideo } from '@/lib/reviewStatus';

interface Version {
  id: string;
  group_id: string | null;
  task_id: string | null;
  versao: number;
  file_name: string;
  status: ReviewStatus;
}
interface Group { id: string; current: Version; count: number }

interface Props {
  projectId: string;
  task: { id: string; status: string };
  canManage: boolean;
}

/**
 * Revisão de vídeo DENTRO da tarefa: mostra o vídeo vinculado (status + comentários)
 * e permite vincular/desvincular um vídeo que está em revisão.
 *
 * A TAREFA é a fonte da verdade: ao vincular, o vídeo assume o status da tarefa.
 */
export default function TaskVideoReview({ projectId, task, canManage }: Props) {
  const { profile } = useAuth();
  const toast = useToast();
  const [groups, setGroups] = useState<Group[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reviewModal, setReviewModal] = useState<{ versionId: string; token: string; fileName: string; versao: number } | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('video_versions')
      .select('id, group_id, task_id, versao, file_name, status')
      .eq('project_id', projectId)
      .order('versao', { ascending: false });

    const vs = (data as Version[]) || [];
    // Cada "vídeo" é um grupo de versões; a mais recente é a atual.
    const byGroup = new Map<string, Version[]>();
    vs.forEach(v => {
      const g = v.group_id || v.id;
      byGroup.set(g, [...(byGroup.get(g) || []), v]);
    });
    const gs: Group[] = [...byGroup.entries()].map(([id, versions]) => ({
      id,
      current: [...versions].sort((a, b) => b.versao - a.versao)[0],
      count: versions.length,
    }));
    setGroups(gs);

    const ids = vs.map(v => v.id);
    if (ids.length) {
      const { data: cs } = await supabase.from('review_comments').select('video_version_id').in('video_version_id', ids);
      const map: Record<string, number> = {};
      (cs || []).forEach((c: any) => { map[c.video_version_id] = (map[c.video_version_id] || 0) + 1; });
      setCounts(map);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const linked = groups.find(g => g.current.task_id === task.id);
  const livres = groups.filter(g => !g.current.task_id || g.current.task_id === task.id);

  const link = async (groupId: string) => {
    if (!groupId) return;
    setBusy(true);
    const g = groups.find(x => x.id === groupId);
    const { error } = await supabase.from('video_versions').update({ task_id: task.id }).eq('group_id', groupId);
    if (error) { toast.error('Não foi possível vincular o vídeo.'); setBusy(false); return; }

    // A tarefa manda: o vídeo assume o status dela.
    if (g) {
      const next = taskStatusToVideo(task.status, g.current.status);
      if (next && next !== g.current.status) {
        await supabase.from('video_versions')
          .update({ status: next, updated_at: new Date().toISOString() })
          .eq('id', g.current.id);
        toast.success(`Vídeo vinculado e com o status da tarefa: ${STATUS_UI[next].label}.`);
      } else {
        toast.success('Vídeo vinculado ✓');
      }
    }
    setBusy(false);
    load();
  };

  const unlink = async () => {
    if (!linked) return;
    setBusy(true);
    const { error } = await supabase.from('video_versions').update({ task_id: null }).eq('group_id', linked.id);
    setBusy(false);
    if (error) { toast.error('Não foi possível desvincular.'); return; }
    toast.success('Vídeo desvinculado.');
    load();
  };

  // Abre a revisão interna (mesmo caminho do painel: garante um token de stream).
  const openReview = async (g: Group) => {
    setBusy(true);
    let { data: link } = await supabase.from('review_links')
      .select('id, token').eq('group_id', g.id).eq('active', true).maybeSingle();
    if (!link) {
      const { data } = await supabase.from('review_links')
        .insert([{ video_version_id: g.current.id, group_id: g.id, created_by: profile?.id }])
        .select('id, token').single();
      link = data as any;
    }
    setBusy(false);
    if (!link) { toast.error('Não foi possível abrir a revisão.'); return; }
    setReviewModal({ versionId: g.current.id, token: link.token, fileName: g.current.file_name, versao: g.current.versao });
  };

  if (loading) return null;
  // Nada para mostrar e nada para vincular: não polui a tarefa.
  if (!linked && (!canManage || livres.length === 0)) return null;

  return (
    <>
      <div className="space-y-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary">Revisão de vídeo</span>

        {linked ? (
          <div className="flex items-center gap-2 p-2.5 rounded-lumos border border-lumos-border bg-lumos-bg/40">
            <Film className="w-4 h-4 text-lumos-yellow flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-mono font-black text-lumos-text-secondary">v{String(linked.current.versao).padStart(2, '0')}</span>
                <span className="text-xs font-bold text-lumos-text-primary truncate">{linked.current.file_name}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <span className={clsx('text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border whitespace-nowrap', STATUS_UI[linked.current.status].color)}>
                  {STATUS_UI[linked.current.status].label}
                </span>
                {(counts[linked.current.id] || 0) > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-lumos-text-secondary">
                    <MessageSquare className="w-3 h-3" />{counts[linked.current.id]}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => openReview(linked)}
              disabled={busy}
              title="Abrir revisão"
              className="btn-primary h-8 px-3 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest rounded-lumos disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Revisar
            </button>
            {canManage && (
              <button
                type="button"
                onClick={unlink}
                disabled={busy}
                title="Desvincular vídeo"
                className="p-1.5 rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-red-400 hover:border-red-400/40 transition-colors disabled:opacity-50"
              >
                <Unlink className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Link2 className="w-3.5 h-3.5 text-lumos-text-secondary flex-shrink-0" />
            <Select
              value=""
              onChange={link}
              className="input-lumos h-8 text-[11px] py-0 flex-1"
              options={[
                { value: '', label: 'Vincular um vídeo em revisão…' },
                ...livres.map(g => ({
                  value: g.id,
                  label: `v${String(g.current.versao).padStart(2, '0')} · ${g.current.file_name}`,
                })),
              ]}
            />
          </div>
        )}
      </div>

      {reviewModal && (
        <InternalReviewModal
          versionId={reviewModal.versionId}
          token={reviewModal.token}
          fileName={reviewModal.fileName}
          versao={reviewModal.versao}
          onClose={() => { setReviewModal(null); load(); }}
        />
      )}
    </>
  );
}
