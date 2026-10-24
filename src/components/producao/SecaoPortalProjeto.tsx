import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/components/ui/useConfirm';

const faltaTabela = (e: { code?: string } | null) => e?.code === '42P01' || e?.code === 'PGRST205';

type Estado = 'no_prazo' | 'atencao' | 'atrasado' | null;
interface Saude { calculada: Estado; exibida: Estado; motivo: string | null; liberar_em: string | null }
interface Pendencia { id: string; texto: string; prazo: string | null; concluida_em: string | null }
interface Membro { app_user_id: string; ordem: number }

const ROTULO: Record<string, string> = { no_prazo: 'No prazo', atencao: 'Atenção', atrasado: 'Atrasado' };
const rotulo = (e: Estado) => (e ? ROTULO[e] : 'Sem indicador');

/** Horas que faltam para o cliente ver o estado segurado. */
const horasAte = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 3600000));

/**
 * O que o cliente vê deste projeto no portal: saúde (com o aviso das 24 h),
 * pendências do cliente e quem aparece na equipe. A equipe enxerga o motivo
 * interno do cálculo; o cliente nunca.
 */
export default function SecaoPortalProjeto({ projectId, clientId }: { projectId: string; clientId: string | null }) {
  const { profile } = useAuth();
  const toast = useToast();
  const { confirm, dialog: dialogoConfirmar } = useConfirm();
  // O objeto do toast muda a cada render; a ref evita que carregar() seja recriado (e o efeito rode em laço).
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [saude, setSaude] = useState<Saude | null>(null);
  const [pendencias, setPendencias] = useState<Pendencia[]>([]);
  const [membros, setMembros] = useState<Membro[]>([]);
  const [usuarios, setUsuarios] = useState<{ id: string; full_name: string }[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [semBanco, setSemBanco] = useState(false);
  const [liberando, setLiberando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [movendo, setMovendo] = useState(false);
  const seq = useRef(0);
  const [texto, setTexto] = useState('');
  const [prazo, setPrazo] = useState('');

  /**
   * `recalcular` só na primeira carga: depois de uma ação a tela apenas relê o que
   * já está salvo. `seq` descarta resposta que chegou depois de uma mais nova.
   */
  const carregar = useCallback(async ({ recalcular = true }: { recalcular?: boolean } = {}) => {
    const minha = ++seq.current;
    // Recalcula na hora para a equipe não olhar um número de uma hora atrás.
    if (recalcular) await supabase.rpc('portal_recalcular_saude', { p_project_id: projectId });
    if (minha !== seq.current) return;
    const [s, p, m, u] = await Promise.all([
      supabase.from('project_portal_saude').select('calculada, exibida, motivo, liberar_em').eq('project_id', projectId).maybeSingle(),
      supabase.from('portal_pendencias').select('id, texto, prazo, concluida_em').eq('project_id', projectId).order('created_at'),
      supabase.from('project_portal_equipe').select('app_user_id, ordem').eq('project_id', projectId).order('ordem').order('app_user_id'),
      supabase.from('app_users').select('id, full_name, hidden').eq('status', 'ativo').order('full_name'),
    ]);
    if (minha !== seq.current) return;
    if (faltaTabela(s.error) || faltaTabela(p.error) || faltaTabela(m.error)) { setSemBanco(true); setCarregando(false); return; }
    if (s.error || p.error || m.error || u.error) toastRef.current.error('Não foi possível carregar o portal deste projeto.');
    setSemBanco(false);
    setSaude((s.data as Saude) || null);
    setPendencias((p.data as Pendencia[]) || []);
    setMembros((m.data as Membro[]) || []);
    setUsuarios(((u.data as any[]) || []).filter(x => !x.hidden));
    setCarregando(false);
  }, [projectId]);
  useEffect(() => {
    // Falha de rede não pode virar promise sem tratamento nem deixar o spinner eterno.
    carregar().catch(() => { toastRef.current.error('Não foi possível carregar o portal deste projeto.'); setCarregando(false); });
  }, [carregar]);
  /** Depois de uma ação: relê sem recalcular a saúde. */
  const recarregar = () => { carregar({ recalcular: false }).catch(() => {}); };

  const segurada = !!saude?.liberar_em && saude.calculada !== saude.exibida;

  const liberar = async () => {
    setLiberando(true);
    const { error } = await supabase.rpc('portal_saude_liberar', { p_project_id: projectId });
    setLiberando(false);
    if (error) { toast.error('Não foi possível liberar agora.'); return; }
    toast.success('O cliente já vê o novo estado.');
    recarregar();
  };

  const adicionar = async () => {
    if (!texto.trim() || !clientId || salvando) return;
    setSalvando(true);
    const { error } = await supabase.from('portal_pendencias').insert({
      client_id: clientId, project_id: projectId, texto: texto.trim().slice(0, 200),
      prazo: prazo || null, created_by: profile?.id ?? null,
    });
    setSalvando(false);
    if (error) { toast.error('Não foi possível salvar.'); return; } // mantém o que foi digitado
    setTexto(''); setPrazo('');
    recarregar();
  };
  const concluir = async (id: string) => {
    const { error } = await supabase.from('portal_pendencias').update({ concluida_em: new Date().toISOString() }).eq('id', id);
    if (error) { toast.error('Não foi possível salvar.'); return; }
    recarregar();
  };
  const apagar = async (p: Pendencia) => {
    if (!await confirm({
      title: 'Apagar pendência',
      message: `Apagar "${p.texto}"? O cliente deixa de ver esse pedido.`,
      confirmLabel: 'Apagar', danger: true,
    })) return;
    const { error } = await supabase.from('portal_pendencias').delete().eq('id', p.id);
    if (error) { toast.error('Não foi possível apagar.'); return; }
    recarregar();
  };

  const alternarMembro = async (userId: string) => {
    const ja = membros.find(m => m.app_user_id === userId);
    const { error } = ja
      ? await supabase.from('project_portal_equipe').delete().eq('project_id', projectId).eq('app_user_id', userId)
      : await supabase.from('project_portal_equipe').insert({
          project_id: projectId, app_user_id: userId,
          ordem: (membros.reduce((mx, m) => Math.max(mx, m.ordem), 0)) + 1,
        });
    if (error) { toast.error('Não foi possível salvar.'); return; }
    recarregar();
  };
  const mover = async (userId: string, dir: -1 | 1) => {
    if (movendo) return;
    const i = membros.findIndex(m => m.app_user_id === userId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= membros.length) return;
    // Renumera pela posição (1, 2, 3…) em vez de trocar os valores guardados:
    // assim números repetidos ou com buraco também se corrigem.
    const nova = [...membros];
    [nova[i], nova[j]] = [nova[j], nova[i]];
    const mudar = nova.map((m, k) => ({ m, ordem: k + 1 })).filter(x => x.m.ordem !== x.ordem);
    setMovendo(true);
    const rs = await Promise.all(mudar.map(x =>
      supabase.from('project_portal_equipe').update({ ordem: x.ordem }).eq('project_id', projectId).eq('app_user_id', x.m.app_user_id)));
    setMovendo(false);
    if (rs.some(r => r.error)) toast.error('Não foi possível reordenar.');
    recarregar();
  };

  // Sem o banco novo (ou ainda carregando) a seção não aparece: nem caixa, nem aviso.
  if (carregando || semBanco) return null;

  const nomeDe = (id: string) => usuarios.find(u => u.id === id)?.full_name || 'Pessoa';

  return (
    <div className="card p-5 md:p-6">
    <section className="space-y-5">
      <header>
        <h3 className="text-sm font-semibold text-lumos-text-primary">Portal do cliente</h3>
        <p className="text-xs text-lumos-text-secondary mt-0.5">O que o cliente vê deste projeto no portal.</p>
      </header>

      <div className="rounded-lumos border border-lumos-border bg-lumos-surface/40 p-3 space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-lumos-text-secondary">Saúde do projeto</p>
        <p className="text-sm text-lumos-text-primary">
          O cliente vê: <b>{rotulo(saude?.exibida ?? null)}</b>
          {saude?.calculada !== saude?.exibida && <> · Calculado agora: <b>{rotulo(saude?.calculada ?? null)}</b></>}
        </p>
        {saude?.motivo && <p className="text-xs text-lumos-text-secondary">Motivo (só a equipe vê): {saude.motivo}</p>}
        {segurada && saude?.liberar_em && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-lumos-text-primary">
              O cliente passa a ver "{rotulo(saude.calculada)}" em cerca de {horasAte(saude.liberar_em)} h.
              Corrija a causa e isso se desfaz sozinho.
            </p>
            <button type="button" onClick={liberar} disabled={liberando} className="btn-secondary h-9 px-3 text-xs">
              {liberando ? 'Liberando…' : 'Mostrar agora'}
            </button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-lumos-text-secondary">O que precisamos do cliente</p>
        {pendencias.filter(p => !p.concluida_em).length === 0 && (
          <p className="text-xs text-lumos-text-secondary">Nenhuma pendência em aberto.</p>
        )}
        {pendencias.filter(p => !p.concluida_em).map(p => (
          <div key={p.id} className="flex items-center gap-2 rounded-lumos border border-lumos-border px-3 py-2">
            <span className="flex-1 min-w-0 text-sm text-lumos-text-primary break-words">
              {p.texto}{p.prazo && <span className="text-xs text-lumos-text-secondary"> · até {p.prazo.split('-').reverse().join('/')}</span>}
            </span>
            <button type="button" onClick={() => concluir(p.id)} aria-label={`Marcar como feita: "${p.texto}"`} title="Marcar como feita"
              className="h-9 w-9 flex-shrink-0 flex items-center justify-center rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary">
              <Check className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => apagar(p)} aria-label={`Apagar: "${p.texto}"`} title="Apagar"
              className="h-9 w-9 flex-shrink-0 flex items-center justify-center rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-danger-fg">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        <div className="flex flex-wrap items-end gap-2">
          <input value={texto} onChange={e => setTexto(e.target.value)} maxLength={200}
            onKeyDown={e => { if (e.key === 'Enter') adicionar(); }}
            placeholder="Ex.: enviar logo em vetor" aria-label="Nova pendência do cliente"
            className="input-lumos h-10 text-sm flex-1 min-w-[12rem]" />
          <label className="flex flex-col gap-0.5 text-[10px] font-bold text-lumos-text-secondary">
            Prazo (opcional)
            <input type="date" value={prazo} onChange={e => setPrazo(e.target.value)} aria-label="Prazo (opcional)"
              className="input-lumos h-10 text-sm" />
          </label>
          <button type="button" onClick={adicionar} disabled={!texto.trim() || !clientId || salvando}
            className="btn-primary h-10 px-4 text-xs font-bold disabled:opacity-60">
            {salvando ? 'Salvando…' : 'Adicionar'}
          </button>
        </div>
        {!clientId && (
          <p className="text-xs text-lumos-text-secondary">Este projeto ainda não tem cliente vinculado.</p>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-lumos-text-secondary">Equipe que aparece no portal</p>
        <p className="text-xs text-lumos-text-secondary">Só aparece para clientes com "mostrar equipe" ligado no portal deles.</p>
        {membros.map((m, i) => (
          <div key={m.app_user_id} className="flex items-center gap-2 rounded-lumos border border-lumos-border px-3 py-2">
            <span className="flex-1 min-w-0 truncate text-sm text-lumos-text-primary">{nomeDe(m.app_user_id)}</span>
            <button type="button" disabled={i === 0 || movendo} onClick={() => mover(m.app_user_id, -1)} aria-label={`Subir ${nomeDe(m.app_user_id)}`}
              className="h-9 w-9 flex-shrink-0 flex items-center justify-center rounded-lumos border border-lumos-border disabled:opacity-30"><ArrowUp className="w-4 h-4" /></button>
            <button type="button" disabled={i === membros.length - 1 || movendo} onClick={() => mover(m.app_user_id, 1)} aria-label={`Descer ${nomeDe(m.app_user_id)}`}
              className="h-9 w-9 flex-shrink-0 flex items-center justify-center rounded-lumos border border-lumos-border disabled:opacity-30"><ArrowDown className="w-4 h-4" /></button>
            <button type="button" onClick={() => alternarMembro(m.app_user_id)} aria-label={`Tirar ${nomeDe(m.app_user_id)}`}
              className="h-9 w-9 flex-shrink-0 flex items-center justify-center rounded-lumos border border-lumos-border hover:text-danger-fg"><X className="w-4 h-4" /></button>
          </div>
        ))}
        <select value="" onChange={e => { if (e.target.value) alternarMembro(e.target.value); }} aria-label="Adicionar pessoa à equipe do portal"
          className="input-lumos h-10 text-sm">
          <option value="">Adicionar pessoa…</option>
          {usuarios.filter(u => !membros.some(m => m.app_user_id === u.id)).map(u => (
            <option key={u.id} value={u.id}>{u.full_name}</option>
          ))}
        </select>
      </div>
    </section>
    {dialogoConfirmar}
    </div>
  );
}
