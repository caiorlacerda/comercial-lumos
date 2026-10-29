import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import Modal from '@/components/common/Modal';
import Select from '@/components/ui/Select';

/**
 * Troca os nomes livres do cronograma ("Italo", "Freela 01"...) por pessoas cadastradas no app.
 * Junta os nomes iguais de TODAS as semanas e liga cada um a uma pessoa de uma vez; os itens
 * continuam onde estão, só a linha passa a ser da pessoa (foto, cargo e as diárias dela entram sozinhas).
 */

interface Pessoa { id: string; full_name: string; job_title: string | null }
interface Grupo { chave: string; nome: string; linhas: { id: string; semana_id: string }[] }

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');

/** Sugere a pessoa quando só UMA começa com esse nome ("Italo" → "Italo Gomes"). Na dúvida, não sugere. */
const sugerir = (nome: string, pessoas: Pessoa[]): string => {
  const n = normalizar(nome);
  if (!n) return '';
  const candidatas = pessoas.filter(p => { const f = normalizar(p.full_name); return f === n || f.startsWith(`${n} `); });
  return candidatas.length === 1 ? candidatas[0].id : '';
};

export default function VincularNomesModal({ onClose, onConcluido }: { onClose: () => void; onConcluido: () => void }) {
  const toast = useToast();
  const [pessoas, setPessoas] = useState<Pessoa[] | null>(null);
  const [grupos, setGrupos] = useState<Grupo[] | null>(null);
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const [pr, lr] = await Promise.all([
        supabase.from('app_users').select('id, full_name, job_title').eq('status', 'ativo').eq('hidden', false).order('full_name'),
        supabase.from('cronograma_linhas').select('id, semana_id, nome').eq('tipo', 'pessoa').is('user_id', null).not('nome', 'is', null),
      ]);
      if (!vivo) return;
      if (pr.error || lr.error) { toast.error('Não foi possível carregar os nomes.'); setPessoas([]); setGrupos([]); return; }
      const ps = (pr.data as Pessoa[]) || [];
      const porNome = new Map<string, Grupo>();
      ((lr.data as { id: string; semana_id: string; nome: string }[]) || []).forEach(l => {
        const chave = normalizar(l.nome);
        if (!chave) return;
        const g = porNome.get(chave) ?? { chave, nome: l.nome.trim(), linhas: [] };
        g.linhas.push({ id: l.id, semana_id: l.semana_id });
        porNome.set(chave, g);
      });
      const gs = [...porNome.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      setPessoas(ps);
      setGrupos(gs);
      setEscolhas(Object.fromEntries(gs.map(g => [g.chave, sugerir(g.nome, ps)])));
    })();
    return () => { vivo = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const opcoes = useMemo(() => [
    { value: '', label: 'Não vincular' },
    ...(pessoas || []).map(p => ({ value: p.id, label: p.full_name + (p.job_title ? ` · ${p.job_title}` : '') })),
  ], [pessoas]);

  const escolhidos = (grupos || []).filter(g => escolhas[g.chave]);

  const vincular = async () => {
    setSalvando(true);
    let ligadas = 0, puladas = 0, falhou = false;
    for (const g of escolhidos) {
      const userId = escolhas[g.chave];
      // Quem já tem linha na mesma semana não ganha uma segunda (duas linhas da mesma pessoa).
      const semanas = [...new Set(g.linhas.map(l => l.semana_id))];
      const { data: jaTem } = await supabase.from('cronograma_linhas').select('semana_id').eq('user_id', userId).in('semana_id', semanas);
      const ocupadas = new Set((jaTem || []).map((x: { semana_id: string }) => x.semana_id));
      const ids = g.linhas.filter(l => !ocupadas.has(l.semana_id)).map(l => l.id);
      puladas += g.linhas.length - ids.length;
      if (ids.length === 0) continue;
      const { error } = await supabase.from('cronograma_linhas').update({ user_id: userId, nome: null }).in('id', ids);
      if (error) { falhou = true; break; }
      ligadas += ids.length;
    }
    setSalvando(false);
    if (falhou) { toast.error('Não foi possível vincular todos. Confira o que mudou e tente de novo.'); onConcluido(); return; }
    toast.success(`${ligadas} ${ligadas === 1 ? 'linha vinculada' : 'linhas vinculadas'}${puladas ? ` · ${puladas} já tinham a pessoa na semana e ficaram como estão` : ''}.`);
    onConcluido();
    onClose();
  };

  return (
    <Modal isOpen onClose={onClose} title="Vincular nomes a pessoas do app">
      <div className="space-y-4">
        <p className="text-xs text-lumos-text-secondary">
          Cada nome livre do cronograma pode virar uma pessoa cadastrada. A troca vale para <b>todas as semanas</b> em que o nome aparece, e os itens não mudam de lugar.
        </p>
        {grupos === null || pessoas === null ? (
          <p className="text-xs text-lumos-text-secondary">Carregando…</p>
        ) : grupos.length === 0 ? (
          <p className="text-xs text-lumos-text-secondary border border-lumos-border rounded-lumos p-4">Não há nomes livres: todas as linhas já são de pessoas do app.</p>
        ) : (
          <div className="max-h-[55vh] overflow-y-auto divide-y divide-lumos-border/60 border border-lumos-border rounded-lumos">
            {grupos.map(g => {
              const semanas = new Set(g.linhas.map(l => l.semana_id)).size;
              return (
                <div key={g.chave} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="w-32 flex-shrink-0 min-w-0">
                    <p className="text-xs font-black text-lumos-text-primary truncate" title={g.nome}>{g.nome}</p>
                    <p className="text-[10px] text-lumos-text-secondary">{semanas} {semanas === 1 ? 'semana' : 'semanas'}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <Select value={escolhas[g.chave] || ''} onChange={v => setEscolhas(e => ({ ...e, [g.chave]: v }))} searchable
                      placeholder="Escolha uma pessoa" className="input-lumos w-full" options={opcoes} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-lumos-text-secondary">{escolhidos.length} {escolhidos.length === 1 ? 'nome será vinculado' : 'nomes serão vinculados'}</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="h-10 px-4 text-xs font-black rounded-lumos border border-lumos-border text-lumos-text-primary hover:border-lumos-yellow/50">Fechar</button>
            <button disabled={escolhidos.length === 0 || salvando} onClick={vincular} className="btn-primary h-10 px-5 text-xs font-black disabled:opacity-50">
              {salvando ? 'Vinculando…' : 'Vincular'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
