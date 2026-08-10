import { useCallback, useEffect, useState } from 'react';
import { Copy, ExternalLink, Loader2, RefreshCw, Eye } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import Modal from '@/components/common/Modal';
import Select from '@/components/ui/Select';

interface Blocks {
  kpis: boolean; status_bar: boolean; etapas: boolean; atividade: boolean; arquivos: boolean;
}
interface Portal {
  id: string; token: string; active: boolean; show_financeiro: boolean;
  contact_user_id: string | null; contact_user_ids: string[]; blocks: Blocks;
  last_opened_at: string | null; opened_count: number;
}

// O que o cliente vê no Dashboard — cada item liga/desliga por projeto.
const BLOCOS: { key: keyof Blocks; label: string; desc: string }[] = [
  { key: 'kpis', label: 'Números do topo', desc: 'progresso, com você, aprovadas e entrega final' },
  { key: 'status_bar', label: 'Barra por status', desc: 'quantas entregas em cada situação' },
  { key: 'etapas', label: 'Etapas do projeto', desc: 'roteiro → captação → edição → revisão' },
  { key: 'atividade', label: 'Atividade', desc: 'histórico do que foi entregue e aprovado' },
  { key: 'arquivos', label: 'Arquivos', desc: 'documentos marcados como "Entrega (portal)"' },
];
const BLOCKS_PADRAO: Blocks = { kpis: true, status_bar: true, etapas: true, atividade: true, arquivos: true };

interface Props {
  projectId: string;
  projectName: string;
  open: boolean;
  onClose: () => void;
  teamUsers: { id: string; full_name: string }[];
}

// Gestão do Portal do Cliente de um projeto: gerar/copiar o link, ligar o
// resumo financeiro, escolher o contato do card de atendimento e revogar.
export default function PortalModal({ projectId, projectName, open, onClose, teamUsers }: Props) {
  const { profile } = useAuth();
  const toast = useToast();
  const [portal, setPortal] = useState<Portal | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const portalUrl = (t: string) => `${window.location.origin}/portal/${t}`;

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('project_portals')
      .select('*').eq('project_id', projectId).eq('active', true)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    setPortal((data as Portal) || null);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const create = async () => {
    setBusy(true);
    const { data, error } = await supabase.from('project_portals')
      .insert([{ project_id: projectId, created_by: profile?.id, contact_user_ids: profile?.id ? [profile.id] : [] }])
      .select('*').single();
    setBusy(false);
    if (error || !data) { toast.error('Não foi possível criar o portal.'); return; }
    setPortal(data as Portal);
    await navigator.clipboard.writeText(portalUrl((data as Portal).token)).catch(() => {});
    toast.success('Portal criado e link copiado ✓');
  };

  const copy = async () => {
    if (!portal) return;
    await navigator.clipboard.writeText(portalUrl(portal.token)).catch(() => {});
    toast.success('Link copiado ✓');
  };

  const patch = async (fields: Partial<Portal>, okMsg: string) => {
    if (!portal) return;
    const prev = portal;
    setPortal({ ...portal, ...fields });
    const { error } = await supabase.from('project_portals').update(fields).eq('id', portal.id);
    if (error) { setPortal(prev); toast.error('Não foi possível salvar.'); return; }
    toast.success(okMsg);
  };

  // Revogar = desativa o link atual; gerar de novo cria token novo.
  const revoke = async () => {
    if (!portal) return;
    setBusy(true);
    const { error } = await supabase.from('project_portals').update({ active: false }).eq('id', portal.id);
    setBusy(false);
    if (error) { toast.error('Não foi possível revogar.'); return; }
    setPortal(null);
    toast.success('Link revogado. O cliente perdeu o acesso.');
  };

  return (
    <Modal isOpen={open} onClose={onClose} title="Portal do cliente" maxWidth="max-w-lg">
      <div className="space-y-4">
        <p className="text-xs text-lumos-text-secondary -mt-1">
          Um dashboard exclusivo de <b className="text-lumos-text-primary">{projectName}</b> pro cliente acompanhar entregas, etapas e aprovar vídeos.
        </p>

        {loading ? (
          <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-lumos-yellow" /></div>
        ) : !portal ? (
          <div className="border border-dashed border-lumos-border rounded-lumos p-6 text-center">
            <p className="text-sm font-bold text-lumos-text-primary">Este projeto ainda não tem portal.</p>
            <p className="text-xs text-lumos-text-secondary mt-1">O link é secreto e pode ser revogado a qualquer momento.</p>
            <button onClick={create} disabled={busy}
              className="btn-primary mt-4 px-5 h-10 text-sm font-black inline-flex items-center gap-2 disabled:opacity-60">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Gerar link do portal
            </button>
          </div>
        ) : (
          <>
            {/* Link */}
            <div>
              <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Link do cliente</label>
              <div className="flex gap-2 mt-1.5">
                <input readOnly value={portalUrl(portal.token)} className="input-lumos flex-1 h-10 text-xs font-mono" onFocus={e => e.target.select()} />
                <button onClick={copy} className="btn-secondary h-10 px-3" title="Copiar"><Copy className="w-4 h-4" /></button>
                <a href={portalUrl(portal.token)} target="_blank" rel="noopener noreferrer" className="btn-secondary h-10 px-3 flex items-center" title="Abrir">
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
              <p className="text-[10.5px] text-lumos-text-secondary mt-1.5 flex items-center gap-1.5">
                <Eye className="w-3 h-3" />
                {portal.opened_count > 0
                  ? <>aberto {portal.opened_count}× · última vez {portal.last_opened_at ? new Date(portal.last_opened_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : ''}</>
                  : 'o cliente ainda não abriu'}
              </p>
            </div>

            {/* O que o cliente vê no Dashboard */}
            <div>
              <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">O que o cliente vê no Dashboard</label>
              <div className="mt-1.5 border border-lumos-border rounded-lumos divide-y divide-lumos-border/60">
                {BLOCOS.map(b => {
                  const blocks = { ...BLOCKS_PADRAO, ...(portal.blocks || {}) };
                  const on = blocks[b.key];
                  return (
                    <div key={b.key} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                      <span className="min-w-0">
                        <span className="block text-xs font-bold text-lumos-text-primary">{b.label}</span>
                        <span className="block text-[10.5px] text-lumos-text-secondary">{b.desc}</span>
                      </span>
                      <button type="button"
                        onClick={() => patch({ blocks: { ...blocks, [b.key]: !on } }, on ? `"${b.label}" oculto pro cliente.` : `"${b.label}" visível pro cliente.`)}
                        className={clsx('w-10 h-5 rounded-full relative transition-colors flex-shrink-0', on ? 'bg-lumos-yellow' : 'bg-lumos-text-secondary/30')}>
                        <span className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all', on ? 'left-5' : 'left-0.5')} />
                      </button>
                    </div>
                  );
                })}
                {/* Financeiro mora aqui junto, é só mais um bloco do dashboard */}
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-xs font-bold text-lumos-text-primary">Resumo financeiro</span>
                    <span className="block text-[10.5px] text-lumos-text-secondary">Sem valores: só "em dia" ou "pendente" + próximo vencimento.</span>
                  </span>
                  <button type="button" onClick={() => patch({ show_financeiro: !portal.show_financeiro }, portal.show_financeiro ? 'Financeiro oculto.' : 'Financeiro visível no portal.')}
                    className={clsx('w-10 h-5 rounded-full relative transition-colors flex-shrink-0', portal.show_financeiro ? 'bg-lumos-yellow' : 'bg-lumos-text-secondary/30')}>
                    <span className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all', portal.show_financeiro ? 'left-5' : 'left-0.5')} />
                  </button>
                </div>
              </div>
            </div>

            {/* Contatos da aba Atendimento */}
            <div>
              <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Atendimento (quem o cliente pode chamar)</label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {teamUsers.map(u => {
                  const sel = (portal.contact_user_ids || []).includes(u.id);
                  return (
                    <button key={u.id} type="button"
                      onClick={() => {
                        const atuais = portal.contact_user_ids || [];
                        const novos = sel ? atuais.filter(id => id !== u.id) : [...atuais, u.id];
                        patch({ contact_user_ids: novos }, sel ? `${u.full_name.split(' ')[0]} saiu do atendimento.` : `${u.full_name.split(' ')[0]} entrou no atendimento.`);
                      }}
                      className={clsx('text-[11px] font-bold px-3 py-1.5 rounded-full border transition-colors',
                        sel ? 'bg-lumos-yellow/15 border-lumos-yellow/60 text-lumos-yellow' : 'border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary hover:border-lumos-yellow/40')}>
                      {sel && '✓ '}{u.full_name}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10.5px] text-lumos-text-secondary mt-1.5">
                {(portal.contact_user_ids || []).length === 0
                  ? 'Sem ninguém selecionado, a aba Atendimento fica vazia.'
                  : `${portal.contact_user_ids.length} pessoa(s) na aba Atendimento do cliente.`}
              </p>
            </div>

            {/* Revogar */}
            <div className="flex items-center justify-between gap-3 pt-1 border-t border-lumos-border/60">
              <p className="text-[10.5px] text-lumos-text-secondary">Revogar desativa este link na hora. Gerar de novo cria um link diferente.</p>
              <button onClick={revoke} disabled={busy}
                className="flex-shrink-0 text-[11px] font-bold text-red-400 border border-red-500/40 rounded-lumos px-3 py-2 hover:bg-red-500/10 disabled:opacity-60 flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" /> Revogar link
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
