import { useCallback, useEffect, useState } from 'react';
import { Copy, ExternalLink, Loader2, RefreshCw, Eye } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import Modal from '@/components/common/Modal';
import Select from '@/components/ui/Select';

interface Blocks {
  escopo: boolean; cronograma: boolean; arquivos: boolean; atividade: boolean;
}
interface Portal {
  id: string; token: string; active: boolean; show_financeiro: boolean;
  contact_user_ids: string[]; blocks: Blocks;
  last_opened_at: string | null; opened_count: number;
}

// O que o cliente vê. O link agora é do CLIENTE, então isto vale para todos os
// projetos dele — o que entra ou sai de cada projeto é o interruptor de baixo.
const BLOCOS: { key: keyof Blocks; label: string; desc: string }[] = [
  { key: 'escopo', label: 'Pacote do mês', desc: 'o combinado e quanto já saiu, quando o projeto tem contrato por volume' },
  { key: 'cronograma', label: 'Onde o projeto está', desc: 'roteiro, captação, edição, sua revisão e entrega' },
  { key: 'arquivos', label: 'Arquivos', desc: 'documentos marcados como "Entrega (portal)"' },
  { key: 'atividade', label: 'Últimos dias', desc: 'o que foi entregue e aprovado, em todos os projetos' },
];
const BLOCKS_PADRAO: Blocks = { escopo: true, cronograma: true, arquivos: true, atividade: true };

interface Props {
  projectId: string;
  projectName: string;
  clientId: string | null;
  clientName: string;
  open: boolean;
  onClose: () => void;
  teamUsers: { id: string; full_name: string }[];
}

/**
 * O PORTAL É DO CLIENTE, NÃO DO PROJETO.
 *
 * Cliente com seis projetos recebia seis links. Agora é um só, com uma aba por
 * projeto — e este modal, aberto de dentro de um projeto, cuida do link do
 * cliente daquele projeto e do interruptor que decide se ESTE projeto aparece
 * lá dentro.
 */
export default function PortalModal({ projectId, projectName, clientId, clientName, open, onClose, teamUsers }: Props) {
  const { profile } = useAuth();
  const toast = useToast();
  const [portal, setPortal] = useState<Portal | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const portalUrl = (t: string) => `${window.location.origin}/portal/${t}`;

  /**
   * Os projetos do cliente e o que entra no portal.
   *
   * O interruptor existia só pro projeto aberto, então escolher o que o cliente
   * vê exigia abrir projeto por projeto. Agora a escolha inteira é feita daqui.
   */
  const [projetos, setProjetos] = useState<{ id: string; name: string; status: string; portal_visivel: boolean; updated_at: string }[]>([]);

  const carregarProjetos = useCallback(async () => {
    if (!clientId) { setProjetos([]); return; }
    const { data } = await supabase.from('projects')
      .select('id, name, status, portal_visivel, updated_at')
      .eq('client_id', clientId)
      .order('status')
      .order('created_at', { ascending: false });
    setProjetos((data as any[]) || []);
  }, [clientId]);
  useEffect(() => { if (open) carregarProjetos(); }, [open, carregarProjetos]);

  const trocarVisivel = async (id: string, novo: boolean) => {
    setProjetos(prev => prev.map(p => (p.id === id ? { ...p, portal_visivel: novo } : p)));
    const { error } = await supabase.from('projects').update({ portal_visivel: novo }).eq('id', id);
    if (error) { carregarProjetos(); toast.error('Não foi possível salvar.'); return; }
  };

  /** Encerrado há mais de 90 dias sai do portal sozinho, mesmo ligado. */
  const foraPorTempo = (p: { status: string; updated_at: string }) =>
    p.status === 'concluido' && Date.now() - new Date(p.updated_at).getTime() > 90 * 86400000;

  const load = useCallback(async () => {
    if (!clientId) { setPortal(null); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase.from('client_portals')
      .select('*').eq('client_id', clientId).eq('active', true)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    setPortal((data as Portal) || null);
    setLoading(false);
  }, [clientId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const create = async () => {
    if (!clientId) { toast.error('Este projeto está sem cliente.'); return; }
    setBusy(true);
    const { data, error } = await supabase.from('client_portals')
      .insert([{ client_id: clientId, created_by: profile?.id, contact_user_ids: profile?.id ? [profile.id] : [] }])
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
    const { error } = await supabase.from('client_portals').update(fields).eq('id', portal.id);
    if (error) { setPortal(prev); toast.error('Não foi possível salvar.'); return; }
    toast.success(okMsg);
  };

  // Revogar = desativa o link atual; gerar de novo cria token novo.
  const revoke = async () => {
    if (!portal) return;
    setBusy(true);
    const { error } = await supabase.from('client_portals').update({ active: false }).eq('id', portal.id);
    setBusy(false);
    if (error) { toast.error('Não foi possível revogar.'); return; }
    setPortal(null);
    toast.success('Link revogado. O cliente perdeu o acesso.');
  };

  return (
    <Modal isOpen={open} onClose={onClose} title="Portal do cliente" maxWidth="max-w-lg">
      <div className="space-y-4">
        <p className="text-xs text-lumos-text-secondary -mt-1">
          Um link só de <b className="text-lumos-text-primary">{clientName || 'cliente'}</b>, com uma aba por projeto.
          Ele acompanha as entregas, vê onde cada projeto está e aprova os vídeos por ali.
        </p>

        {loading ? (
          <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-lumos-yellow" /></div>
        ) : !portal ? (
          <div className="border border-dashed border-lumos-border rounded-lumos p-6 text-center">
            <p className="text-sm font-bold text-lumos-text-primary">
              {clientId ? `${clientName} ainda não tem portal.` : 'Este projeto está sem cliente.'}
            </p>
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
              <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">O que o cliente vê</label>
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

            {/* O que aparece dentro do portal */}
            <div>
              <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">
                Projetos que o cliente vê
              </label>
              <div className="mt-1.5 border border-lumos-border rounded-lumos divide-y divide-lumos-border/60 max-h-64 overflow-y-auto custom-scrollbar">
                {projetos.map(p => {
                  const fora = foraPorTempo(p);
                  return (
                    <div key={p.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                      <span className="min-w-0">
                        <span className="block text-xs font-bold text-lumos-text-primary truncate">
                          {p.name.trim()}
                          {p.id === projectId && <span className="ml-1.5 text-[9px] font-black uppercase text-lumos-yellow">aberto</span>}
                        </span>
                        <span className="block text-[10.5px] text-lumos-text-secondary">
                          {p.status === 'concluido'
                            ? (fora ? 'encerrado há mais de 90 dias, já não aparece' : 'encerrado, ainda aparece por 90 dias')
                            : 'ativo'}
                        </span>
                      </span>
                      <button type="button" disabled={fora}
                        onClick={() => trocarVisivel(p.id, !p.portal_visivel)}
                        title={fora ? 'Encerrado há mais de 90 dias: já saiu do portal' : undefined}
                        className={clsx('w-10 h-5 rounded-full relative transition-colors flex-shrink-0',
                          fora ? 'bg-lumos-text-secondary/15 cursor-not-allowed'
                            : p.portal_visivel ? 'bg-lumos-yellow' : 'bg-lumos-text-secondary/30')}>
                        <span className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all',
                          p.portal_visivel && !fora ? 'left-5' : 'left-0.5')} />
                      </button>
                    </div>
                  );
                })}
                {!projetos.length && (
                  <p className="px-3.5 py-3 text-[11.5px] text-lumos-text-secondary">Este cliente não tem projeto nenhum.</p>
                )}
              </div>
              <p className="text-[10.5px] text-lumos-text-secondary mt-1.5">
                Desligado, o projeto some da lista de abas do cliente. Nada é apagado.
              </p>
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
