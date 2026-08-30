import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Play, Link2, Unlink, Loader2, Upload, MoreVertical, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import { useConfirm } from '@/components/ui/useConfirm';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import Select from '@/components/ui/Select';
import InternalReviewModal from './InternalReviewModal';
import VideoThumb from './VideoThumb';
import { type ReviewStatus, STATUS_UI, taskStatusToVideo } from '@/lib/reviewStatus';
import { moverEtapa, mensagemDaEtapa, sincronizarTarefa } from '@/lib/reviewTransition';

interface Version {
  id: string;
  group_id: string | null;
  task_id: string | null;
  versao: number;
  file_name: string;
  status: ReviewStatus;
}
interface Group { id: string; current: Version; count: number; versions: Version[] }

/** Na sequência do processo, não em ordem alfabética. */
const ORDEM_DO_FLUXO: ReviewStatus[] = [
  'EM_REVISAO_INTERNA', 'ALTERACOES_INTERNAS', 'EM_REVISAO_CLIENTE', 'ALTERACOES_CLIENTE', 'APROVADO',
];

/**
 * POR QUE ESTE CACHE E POR QUE SEM thumb_url.
 *
 * Abrir uma tarefa levava mais de 4 segundos até o vídeo aparecer. O motivo não
 * era o vídeo: a tela pedia TODAS as versões do projeto COM a miniatura, e a
 * miniatura é uma imagem inteira guardada dentro da linha (data URI). No
 * Uniasselvi isso dava 1,65 MB por abertura — 1,64 MB só de imagem — pra
 * desenhar UM card.
 *
 * Agora a consulta vem sem miniatura (15 KB), e a imagem do vídeo vinculado é
 * buscada depois, sozinha, sem segurar o card: o que a pessoa precisa ler é o
 * nome, a versão e a etapa; a imagem é enfeite e pode chegar um instante
 * depois.
 *
 * O resultado fica guardado por projeto e é buscado assim que o projeto abre,
 * então clicar numa tarefa costuma nem ir ao servidor.
 */
const VALIDADE_MS = 60_000;
const cacheVersoes = new Map<string, { versions: Version[]; ts: number }>();
const cacheThumb = new Map<string, string | null>();

async function buscarVersoes(projectId: string): Promise<Version[]> {
  const { data } = await supabase
    .from('video_versions')
    .select('id, group_id, task_id, versao, file_name, status')
    .eq('project_id', projectId)
    .order('versao', { ascending: false });
  const vs = (data as Version[]) || [];
  cacheVersoes.set(projectId, { versions: vs, ts: Date.now() });
  return vs;
}

/**
 * Chamado quando o projeto abre. Quando a pessoa clicar numa tarefa, o dado já
 * está aqui — que é o que faz parecer instantâneo em vez de rápido.
 */
export function prefetchEntregasDoProjeto(projectId: string) {
  const c = cacheVersoes.get(projectId);
  if (c && Date.now() - c.ts < VALIDADE_MS) return;
  void buscarVersoes(projectId);
}

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
  const { profile, isAdmin, can } = useAuth();
  const toast = useToast();
  const [groups, setGroups] = useState<Group[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reviewModal, setReviewModal] = useState<{ versionId: string; token: string; fileName: string; versao: number; version: Version } | null>(null);
  const [enviando, setEnviando] = useState<{ nome: string; pct: number } | null>(null);
  const [menuAberto, setMenuAberto] = useState<string | null>(null);
  const { confirm, dialog: dialogoConfirmar } = useConfirm();
  const [excluindo, setExcluindo] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  // Mesma régua do painel de Entregas: o editor sobe o vídeo, mas quem dá o
  // aval interno é admin, produção ou quem recebeu 'revisao_interna'.
  const podeAvalInterno = isAdmin || can('revisao_interna');
  const inputRef = useRef<HTMLInputElement>(null);

  const agrupar = useCallback((vs: Version[]) => {
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
      versions,
    }));
    setGroups(gs);
    setLoading(false);
    return gs;
  }, []);

  /**
   * O que segura o card é só a lista sem imagem. Contagem de comentários e
   * miniatura entram depois, e só do vídeo desta tarefa: são dois detalhes do
   * card, não motivo pra tela ficar vazia.
   */
  const completar = useCallback(async (gs: Group[]) => {
    const meus = gs.filter(g => g.current.task_id === task.id);
    if (!meus.length) return;
    const ids = meus.flatMap(g => g.versions.map(v => v.id));
    supabase.from('review_comments').select('video_version_id').in('video_version_id', ids)
      .then(({ data: cs }) => {
        const map: Record<string, number> = {};
        (cs || []).forEach((c: any) => { map[c.video_version_id] = (map[c.video_version_id] || 0) + 1; });
        setCounts(map);
      });
    const alvos = meus.map(g => g.current.id);
    const doCache = alvos.filter(id => cacheThumb.has(id));
    if (doCache.length) {
      setThumbs(prev => ({ ...prev, ...Object.fromEntries(doCache.map(id => [id, cacheThumb.get(id) ?? null])) }));
    }
    const faltando = alvos.filter(id => !cacheThumb.has(id));
    if (!faltando.length) return;
    const { data: ts } = await supabase.from('video_versions').select('id, thumb_url').in('id', faltando);
    const novo: Record<string, string | null> = {};
    faltando.forEach(id => { novo[id] = null; });
    (ts || []).forEach((t: any) => { novo[t.id] = t.thumb_url ?? null; });
    Object.entries(novo).forEach(([id, url]) => cacheThumb.set(id, url));
    setThumbs(prev => ({ ...prev, ...novo }));
  }, [task.id]);

  const load = useCallback(async (forcar = false) => {
    const c = cacheVersoes.get(projectId);
    // Tem no cache: desenha na hora. Se estiver velho, revalida por baixo, sem
    // piscar a tela.
    if (!forcar && c) {
      const gs = agrupar(c.versions);
      void completar(gs);
      if (Date.now() - c.ts < VALIDADE_MS) return;
    }
    const vs = await buscarVersoes(projectId);
    void completar(agrupar(vs));
  }, [projectId, agrupar, completar]);

  /** Depois de mexer (vincular, enviar, excluir) o cache não vale mais. A
   *  miniatura entra junto: trocar a capa do vídeo passa por aqui. */
  const recarregar = useCallback(() => {
    cacheVersoes.delete(projectId);
    cacheThumb.clear();
    return load(true);
  }, [projectId, load]);

  useEffect(() => { load(); }, [load]);

  /**
   * TODOS os vídeos desta tarefa, não só o primeiro.
   *
   * A mesma peça costuma sair em 16:9, 9:16 e 1:1, e às vezes em mais formatos.
   * O banco já aceitava vários (cada vídeo guarda o task_id dele); era a tela
   * que mostrava um só — então o segundo formato ficava invisível aqui, mesmo
   * vinculado, e a pessoa achava que não tinha subido.
   */
  const vinculados = groups.filter(g => g.current.task_id === task.id);
  const livres = groups.filter(g => !g.current.task_id);

  const link = async (groupId: string) => {
    if (!groupId) return;
    setBusy(true);
    const g = groups.find(x => x.id === groupId);
    const { error } = await supabase.from('video_versions').update({ task_id: task.id }).eq('group_id', groupId);
    if (error) { toast.error('Não foi possível vincular o vídeo.'); setBusy(false); return; }

    // O vídeo assume o status da tarefa só quando é o PRIMEIRO dela. Com
    // outros formatos já vinculados, cada um segue a própria etapa — o 16:9
    // pode estar aprovado e o 1:1 em ajustes, e é isso que precisa aparecer.
    if (g) {
      const sozinho = !vinculados.some(x => x.id !== groupId);
      const next = sozinho ? taskStatusToVideo(task.status, g.current.status) : null;
      if (next && next !== g.current.status) {
        await supabase.from('video_versions')
          .update({ status: next, updated_at: new Date().toISOString() })
          .eq('id', g.current.id);
        toast.success(`Vídeo vinculado e com o status da tarefa: ${STATUS_UI[next].label}.`);
      } else {
        toast.success('Vídeo vinculado ✓');
      }
    }
    // A tarefa passa a refletir o conjunto (inclusive o formato que acabou de
    // entrar, que pode estar mais atrasado que os outros).
    await sincronizarTarefa(task.id);
    setBusy(false);
    recarregar();
  };

  /**
   * Trocar a etapa direto na pílula do vídeo.
   *
   * Antes a pílula era só um selo: pra mover um formato era preciso abrir a
   * revisão. Com três formatos na mesma tarefa, cada um andando no seu ritmo,
   * isso virava três aberturas pra dizer três coisas simples.
   *
   * Passa pela MESMA transição do resto do app (moverEtapa): o link do cliente
   * nasce na hora certa e a tarefa recalcula pelo conjunto dos formatos.
   */
  const mudarEtapa = async (g: Group, proximo: ReviewStatus) => {
    if (proximo === g.current.status) return;
    setBusy(true);
    const r = await moverEtapa(g.current, proximo, profile?.id);
    setBusy(false);
    if (!r.ok) { toast.error('Não foi possível mudar a etapa.'); return; }
    toast.success(mensagemDaEtapa(proximo, r.criouLink));
    await recarregar();
  };

  const unlink = async (g: Group) => {
    setBusy(true);
    const { error } = await supabase.from('video_versions').update({ task_id: null }).eq('group_id', g.id);
    setBusy(false);
    if (error) { toast.error('Não foi possível desvincular.'); return; }
    toast.success('Vídeo desvinculado.');
    // Sem ele, a tarefa pode ter destravado: recalcula pelos que ficaram.
    await sincronizarTarefa(task.id);
    recarregar();
  };

  /**
   * Excluir de vez: manda o arquivo (e o vFINAL, se houver) pra lixeira do Drive
   * e apaga o registro. Some o grupo inteiro, todas as versões — apagar só a
   * atual deixaria um vídeo meio vivo, com histórico órfão.
   *
   * Mesma função do painel de Entregas, pra não existirem dois jeitos de apagar
   * a mesma coisa.
   */
  const excluir = async (g: Group) => {
    const quantas = g.versions.length;
    const aviso = quantas > 1
      ? `Excluir "${g.current.file_name}" e as ${quantas} versões dele? O arquivo vai pra lixeira do Drive.`
      : `Excluir "${g.current.file_name}"? O arquivo vai pra lixeira do Drive.`;
    if (!await confirm({ title: 'Excluir vídeo', message: aviso, confirmLabel: 'Excluir', danger: true })) return;
    setMenuAberto(null); setExcluindo(true);
    try {
      const { error } = await supabase.functions.invoke('drive-delete', {
        body: { version_ids: g.versions.map(v => v.id) },
      });
      if (error) throw error;
      toast.success('Vídeo excluído ✓');
      await recarregar();
    } catch { toast.error('Não foi possível excluir.'); }
    finally { setExcluindo(false); }
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
    setReviewModal({ versionId: g.current.id, token: link.token, fileName: g.current.file_name, versao: g.current.versao, version: g.current });
  };

  /**
   * Envio direto pela tarefa. O vínculo com a tarefa viaja como propriedade DO
   * ARQUIVO no Drive: o registro no banco só nasce depois, no scan, então
   * amarrar por nome de arquivo seria frágil. Quando o scan cria a versão, ela
   * já vem com task_id e a tarefa entra em revisão interna sozinha.
   *
   * Mesmo caminho do painel do projeto, inclusive a confirmação de upload que
   * evita a cópia duplicada (o Google não devolve CORS e o navegador cega).
   */
  const enviarArquivos = async (arquivos: FileList | null) => {
    const lista = Array.from(arquivos || []).filter(f => /^video\//.test(f.type) || /\.(mp4|mov|m4v|webm|mkv)$/i.test(f.name));
    if (!lista.length) return;

    const { data: { session } } = await supabase.auth.getSession();
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
    const token = session?.access_token || anon;

    for (const file of lista) {
      setEnviando({ nome: file.name, pct: 0 });
      const base = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/drive-upload`
        + `?project_id=${encodeURIComponent(projectId)}&file_name=${encodeURIComponent(file.name)}`
        + `&mime_type=${encodeURIComponent(file.type || 'video/mp4')}&task_id=${encodeURIComponent(task.id)}`;
      try {
        const r = await fetch(`${base}&mode=init&size=${file.size}`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: anon },
        });
        const j = await r.json();
        if (!r.ok || !j?.upload_url) throw new Error(j?.error || 'não deu pra iniciar');

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', j.upload_url);
          xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
          xhr.upload.onprogress = e => { if (e.lengthComputable) setEnviando({ nome: file.name, pct: e.loaded / e.total }); };
          xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`http ${xhr.status}`)));
          xhr.onerror = () => reject(Object.assign(new Error('rede'), { status: 0 }));
          xhr.send(file);
        }).catch(async (e: any) => {
          if (e?.status !== 0) throw e;
          const p = await fetch(`${base}&mode=probe`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, apikey: anon, 'Content-Type': 'application/json' },
            body: JSON.stringify({ upload_url: j.upload_url, size: file.size }),
          });
          const pj = await p.json();
          if (!p.ok || !pj?.complete) throw e;
        });
      } catch (e: any) {
        setEnviando(null);
        toast.error(`${file.name}: ${String(e?.message || 'falhou')}`);
        return;
      }
    }

    setEnviando(null);
    toast.success(`${lista.length} vídeo(s) enviado(s) ✓ Vinculando à tarefa…`);
    // O scan cria o registro já com a tarefa. Damos um tempo e recarregamos.
    await supabase.functions.invoke('review-scan', { body: { project_id: projectId } });
    await recarregar();
  };

  if (loading) return null;
  // Some só pra quem não pode fazer nada aqui. Antes sumia quando não havia
  // vídeo pra vincular — e era justamente o caso em que a pessoa precisa
  // ENVIAR o dela.
  if (!vinculados.length && !canManage) return null;

  return (
    <>
      {dialogoConfirmar}
      <div className="space-y-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary">Revisão de vídeo</span>

        {/* Um card por vídeo da tarefa. A mesma peça sai em 16:9, 9:16 e 1:1,
            e cada formato é um vídeo com a própria revisão e os próprios
            comentários — juntar tudo num card só esconderia dois terços do
            trabalho. */}
        {vinculados.map(g => (
          <div key={g.id} className="flex items-center gap-2 p-2.5 rounded-lumos border border-lumos-border bg-lumos-bg/40">
            <VideoThumb src={thumbs[g.current.id]} className="w-16 aspect-video rounded flex-shrink-0" iconSize="w-6 h-6" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-mono font-black text-lumos-text-secondary">v{String(g.current.versao).padStart(2, '0')}</span>
                <span className="text-xs font-bold text-lumos-text-primary truncate">{g.current.file_name}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                {canManage && podeAvalInterno ? (
                  // Largura própria: o gatilho do Select é w-full, e solto aqui
                  // dentro ele esticava a pílula de ponta a ponta do card.
                  <div className="w-[170px] flex-shrink-0">
                  <Select
                    value={g.current.status}
                    onChange={v => void mudarEtapa(g, v as ReviewStatus)}
                    ariaLabel={`Etapa de ${g.current.file_name}`}
                    menuClassName="min-w-[190px]"
                    className={clsx('h-6 pl-2.5 pr-1.5 rounded-full border text-[9px] font-black uppercase tracking-wider whitespace-nowrap', STATUS_UI[g.current.status].color)}
                    options={ORDEM_DO_FLUXO.map(st => ({ value: st, label: STATUS_UI[st].label }))}
                  />
                  </div>
                ) : (
                  <span className={clsx('text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border whitespace-nowrap', STATUS_UI[g.current.status].color)}>
                    {STATUS_UI[g.current.status].label}
                  </span>
                )}
                {(counts[g.current.id] || 0) > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-lumos-text-secondary">
                    <MessageSquare className="w-3 h-3" />{counts[g.current.id]}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => openReview(g)}
              disabled={busy}
              title="Abrir revisão"
              className="btn-primary h-8 px-3 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest rounded-lumos disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Revisar
            </button>
            {canManage && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuAberto(m => (m === g.id ? null : g.id))}
                  disabled={busy || excluindo}
                  title="Opções"
                  className="p-1.5 rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary transition-colors disabled:opacity-50"
                >
                  {excluindo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MoreVertical className="w-3.5 h-3.5" />}
                </button>
                {menuAberto === g.id && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMenuAberto(null)} />
                    <div className="absolute right-0 top-8 z-50 w-52 py-1 rounded-lumos bg-lumos-surface border border-lumos-border shadow-2xl">
                      <button type="button"
                        onClick={() => { setMenuAberto(null); unlink(g); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-bold text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/10">
                        <Unlink className="w-3.5 h-3.5" /> Desvincular da tarefa
                      </button>
                      {/* Desvincular solta o vínculo e o vídeo continua nas
                          Entregas. Excluir tira do ar de vez. São coisas bem
                          diferentes, então o texto diz o que cada uma faz. */}
                      <button type="button"
                        onClick={() => excluir(g)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-bold text-red-400 hover:bg-red-500/10">
                        <Trash2 className="w-3.5 h-3.5" /> Excluir vídeo
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}

        {enviando ? (

          <div className="p-2.5 rounded-lumos border border-lumos-border bg-lumos-bg/40">
            <div className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-lumos-yellow flex-shrink-0" />
              <span className="text-[11px] font-bold text-lumos-text-primary truncate">{enviando.nome}</span>
              <span className="text-[10px] font-bold tabular-nums text-lumos-text-secondary ml-auto">
                {Math.round(enviando.pct * 100)}%
              </span>
            </div>
            <div className="mt-2 h-1 rounded-full bg-lumos-text-secondary/15 overflow-hidden">
              <div className="h-full bg-lumos-yellow rounded-full transition-all" style={{ width: `${enviando.pct * 100}%` }} />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Enviar direto daqui: o vídeo já nasce ligado a esta tarefa, e a
                tarefa entra em revisão interna sozinha. Continua à mão mesmo
                com vídeo vinculado — é assim que entram o 9:16 e o 1:1 depois
                do 16:9. Aceita vários arquivos de uma vez. */}
            <input ref={inputRef} type="file" accept="video/*" multiple className="hidden"
              onChange={e => { enviarArquivos(e.target.files); e.currentTarget.value = ''; }} />
            <button type="button" onClick={() => inputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); enviarArquivos(e.dataTransfer.files); }}
              className="w-full h-9 rounded-lumos border border-dashed border-lumos-border hover:border-lumos-yellow/60 text-[11px] font-bold text-lumos-text-secondary hover:text-lumos-text-primary flex items-center justify-center gap-2 transition-colors">
              <Upload className="w-3.5 h-3.5" /> {vinculados.length ? 'Enviar outro formato' : 'Enviar vídeo desta tarefa'}
            </button>

            {livres.length > 0 && (
              <div className="flex items-center gap-2">
                <Link2 className="w-3.5 h-3.5 text-lumos-text-secondary flex-shrink-0" />
                <Select
                  value=""
                  onChange={link}
                  className="input-lumos h-8 text-[11px] py-0 flex-1"
                  options={[
                    { value: '', label: vinculados.length ? 'ou vincular outro já enviado…' : 'ou vincular um vídeo já enviado…' },
                    ...livres.map(g => ({
                      value: g.id,
                      label: `v${String(g.current.versao).padStart(2, '0')} · ${g.current.file_name}`,
                    })),
                  ]}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {reviewModal && (
        <InternalReviewModal
          versionId={reviewModal.versionId}
          token={reviewModal.token}
          fileName={reviewModal.fileName}
          versao={reviewModal.versao}
          status={reviewModal.version.status}
          podeDecidir={isAdmin || can('revisao_interna')}
          // Abrir pela tarefa ou pelo painel tem que dar exatamente na mesma
          // coisa: mesma regra de transição, mesmos botões. Duas portas para a
          // mesma sala, não duas salas.
          onDecidir={async (proximo) => {
            const r = await moverEtapa(reviewModal.version, proximo, profile?.id);
            if (!r.ok) { toast.error(`Erro: ${r.erro}`); return; }
            toast.success(mensagemDaEtapa(proximo, r.criouLink));
            setReviewModal(null);
            await recarregar();
          }}
          onClose={() => { setReviewModal(null); recarregar(); }}
        />
      )}
    </>
  );
}
