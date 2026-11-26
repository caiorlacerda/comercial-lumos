import { useEffect, useState } from 'react';
import { AlertTriangle, Search, UserPlus } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { inicial } from '@/lib/iniciais';
import { conflitosPorPessoa, type DiariaDoDia, type VinculoDaEscala } from '@/lib/regrasDaEscala';

/**
 * ESCALA DA DIÁRIA — o que os cards e o painel da diária usam em comum: quem está
 * escalado, quem pode ser escalado e a lista de busca para escolher a pessoa.
 */

export interface MembroDiaria {
  id: string;
  diaria_id: string;
  funcao: string | null;
  user: { id: string; full_name: string } | null;
  freela: { id: string; nome: string } | null;
}

export interface PessoaCatalogo { tipo: 'user' | 'freela'; id: string; nome: string; funcao?: string | null; doProjeto?: boolean }

export const SELECT_DE_MEMBROS = 'id, diaria_id, funcao, user:app_users!user_id(id, full_name), freela:fornecedores(id, nome)';

export const chaveDaPessoa = (p: PessoaCatalogo) => `${p.tipo}:${p.id}`;
export const chaveDoMembro = (m: MembroDiaria) => (m.freela ? `freela:${m.freela.id}` : `user:${m.user?.id}`);
export const nomeDoMembro = (m: MembroDiaria) => m.freela?.nome || m.user?.full_name || '';

export const iniciaisDe = (nome: string) =>
  nome.trim().split(/\s+/).slice(0, 2).map(x => inicial(x).toUpperCase()).join('');

export function AvatarDaPessoa({ nome, fornecedor }: { nome: string; fornecedor: boolean }) {
  return (
    <span className={clsx('w-7 h-7 rounded-full text-[10px] font-black flex items-center justify-center flex-shrink-0',
      fornecedor ? 'bg-lumos-yellow/15 text-lumos-yellow' : 'bg-lumos-text-secondary/15 text-lumos-text-secondary')}>
      {iniciaisDe(nome)}
    </span>
  );
}

/** Quem pode ser escalado: equipe do projeto em destaque, depois fornecedores e o time Lumos. */
export function useCatalogoDeEscala(projectId: string) {
  const [catalogo, setCatalogo] = useState<PessoaCatalogo[]>([]);
  useEffect(() => {
    let vivo = true;
    (async () => {
      const [pm, forn, users] = await Promise.all([
        supabase.from('project_members').select('user_id, freela_id, funcao').eq('project_id', projectId),
        supabase.from('fornecedores').select('id, nome').order('nome'),
        supabase.from('app_users').select('id, full_name').eq('status', 'ativo').order('full_name'),
      ]);
      if (!vivo) return;
      const funcaoDe = new Map<string, string | null>();
      const doProjeto = new Set<string>();
      for (const m of (pm.data as any[]) || []) {
        const k = m.user_id ? `user:${m.user_id}` : `freela:${m.freela_id}`;
        doProjeto.add(k);
        funcaoDe.set(k, m.funcao || null);
      }
      setCatalogo([
        ...(((forn.data as any[]) || []).map(f => ({
          tipo: 'freela' as const, id: f.id, nome: f.nome,
          funcao: funcaoDe.get(`freela:${f.id}`) || null, doProjeto: doProjeto.has(`freela:${f.id}`),
        }))),
        ...(((users.data as any[]) || []).map(u => ({
          tipo: 'user' as const, id: u.id, nome: u.full_name,
          funcao: funcaoDe.get(`user:${u.id}`) || null, doProjeto: doProjeto.has(`user:${u.id}`),
        }))),
      ]);
    })();
    return () => { vivo = false; };
  }, [projectId]);
  return catalogo;
}

/** Quem já está escalado em OUTRA diária na mesma data (qualquer projeto): chave da pessoa → onde. */
export function useConflitosDoDia(data: string | null | undefined, diariaId: string | null, projectId: string) {
  const [conflitos, setConflitos] = useState<Map<string, string[]>>(() => new Map());
  useEffect(() => {
    setConflitos(new Map());
    if (!data) return;
    let vivo = true;
    (async () => {
      const dias = await supabase.from('project_diarias').select('id, nome, project_id, projects(name)').eq('data', data);
      const outras: DiariaDoDia[] = (((dias.data as any[]) || []).filter(d => d.id !== diariaId))
        .map(d => ({ id: d.id, nome: d.nome, project_id: d.project_id, projeto: (Array.isArray(d.projects) ? d.projects[0]?.name : d.projects?.name) ?? null }));
      if (!vivo || outras.length === 0) return;
      const escala = await supabase.from('diaria_members').select('diaria_id, user_id, freela_id').in('diaria_id', outras.map(d => d.id));
      if (vivo && !escala.error) setConflitos(conflitosPorPessoa(outras, (escala.data as VinculoDaEscala[]) || [], projectId));
    })();
    return () => { vivo = false; };
  }, [data, diariaId, projectId]);
  return conflitos;
}

/** Aviso (não impede de escalar): a pessoa já está em outra diária no mesmo dia. */
export function AvisoDeConflito({ onde }: { onde?: string[] }) {
  if (!onde?.length) return null;
  return (
    <span className="flex items-start gap-1 text-[10px] font-bold text-amber-500 leading-snug">
      <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-px" />
      <span className="min-w-0 break-words">Já escalado em {onde.join(', ')} neste dia</span>
    </span>
  );
}

/** Busca + lista agrupada de quem ainda não está escalado. */
export function ListaDeEscalaveis({ catalogo, jaEscalados, onEscolher, conflitos, alturaMax = 'max-h-72' }: {
  catalogo: PessoaCatalogo[];
  jaEscalados: Set<string>;
  conflitos?: Map<string, string[]>;
  onEscolher: (p: PessoaCatalogo) => void;
  alturaMax?: string;
}) {
  const [busca, setBusca] = useState('');
  const q = busca.trim().toLowerCase();
  const disponiveis = catalogo.filter(p => !jaEscalados.has(chaveDaPessoa(p)) && (!q || p.nome.toLowerCase().includes(q)));
  const grupos: { titulo: string; itens: PessoaCatalogo[] }[] = [
    { titulo: 'Equipe do projeto', itens: disponiveis.filter(p => p.doProjeto) },
    { titulo: 'Fornecedores', itens: disponiveis.filter(p => !p.doProjeto && p.tipo === 'freela') },
    { titulo: 'Time Lumos', itens: disponiveis.filter(p => !p.doProjeto && p.tipo === 'user') },
  ].filter(g => g.itens.length > 0);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-lumos-text-secondary pointer-events-none" />
        <input autoFocus value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar pessoa ou fornecedor…" className="input-lumos pl-9 w-full h-10 text-sm" />
      </div>
      <p className="text-[10.5px] text-lumos-text-secondary">
        Fornecedor escalado em diária com data já agenda a cobrança de nota sozinho.
      </p>
      <div className={clsx('border border-lumos-border rounded-lumos overflow-y-auto custom-scrollbar divide-y divide-lumos-border/40', alturaMax)}>
        {grupos.length === 0 && (
          <p className="text-xs text-lumos-text-secondary italic p-4 text-center">Ninguém encontrado.</p>
        )}
        {grupos.map(g => (
          <div key={g.titulo}>
            <p className="text-[9px] font-black uppercase tracking-widest text-lumos-text-secondary bg-lumos-bg/60 px-3 py-1.5 sticky top-0">{g.titulo}</p>
            {g.itens.map(pessoa => (
              <button key={chaveDaPessoa(pessoa)} type="button" onClick={() => onEscolher(pessoa)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-lumos-text-primary/5 transition-colors">
                <AvatarDaPessoa nome={pessoa.nome} fornecedor={pessoa.tipo === 'freela'} />
                <span className="min-w-0 flex-1">
                  <span className="text-xs font-bold text-lumos-text-primary block truncate">{pessoa.nome}</span>
                  <span className="text-[10px] text-lumos-text-secondary block truncate">
                    {pessoa.tipo === 'freela' ? 'Fornecedor' : 'Time Lumos'}{pessoa.funcao ? ` · ${pessoa.funcao}` : ''}
                  </span>
                  <AvisoDeConflito onde={conflitos?.get(chaveDaPessoa(pessoa))} />
                </span>
                <UserPlus className="w-3.5 h-3.5 text-lumos-text-secondary flex-shrink-0" />
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
