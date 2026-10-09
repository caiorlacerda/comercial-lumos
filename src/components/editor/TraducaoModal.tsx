import { useMemo, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { clsx } from 'clsx';
import Modal from '@/components/common/Modal';
import RichTextEditor from '@/components/common/RichTextEditor';
import { useToast } from '@/context/ToastContext';
import type { BudgetItem, BudgetVersion } from '@/utils/financials';
import { chave, coletarTextos, faltantes, mesclar, type Traducoes } from '@/lib/traducaoCore';
import { traduzirTextos } from '@/lib/traducao';

interface Props {
  version: BudgetVersion;
  items: BudgetItem[];
  onClose: () => void;
  /** Recebe o glossário revisado; quem chama grava na versão. */
  onSave: (t: Traducoes) => void;
}

// Texto simples de um trecho HTML, só para mostrar o ORIGINAL ao lado da tradução.
const textoSimples = (html: string) => {
  try {
    return new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() || html;
  } catch { return html; }
};

// O editor rico devolve "<p></p>" quando está vazio (e emite isso ao abrir); isso não é uma tradução.
const htmlVazio = (html: string) => {
  if (chave(html) === '') return true;
  try { return (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '').trim() === ''; } catch { return false; }
};

export default function TraducaoModal({ version, items, onClose, onSave }: Props) {
  const toast = useToast();
  const coletados = useMemo(() => coletarTextos(version, items), [version, items]);
  const [rascunho, setRascunho] = useState<Record<string, string>>(() => ({ ...(version.translations?.textos ?? {}) }));
  const [modelo, setModelo] = useState<string | undefined>(version.translations?.modelo);
  const [traduzindo, setTraduzindo] = useState(false);

  const comoTraducoes = (): Traducoes => ({ versao: 1, textos: rascunho, traduzido_em: version.translations?.traduzido_em, modelo });
  const faltam = faltantes(coletados, comoTraducoes());

  const traduzirComIA = async (somenteFaltantes: boolean) => {
    const alvo = somenteFaltantes ? faltam : coletados;
    if (alvo.length === 0) { toast.warning('Não há textos para traduzir.'); return; }
    setTraduzindo(true);
    try {
      const r = await traduzirTextos(alvo);
      const mesclado = mesclar(comoTraducoes(), r.traducoes, new Date().toISOString(), r.modelo);
      setRascunho(mesclado.textos);
      setModelo(mesclado.modelo);
      toast.success(`${Object.keys(r.traducoes).length} texto(s) traduzido(s). Revise antes de salvar.`);
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível traduzir agora.');
    } finally {
      setTraduzindo(false);
    }
  };

  const mudar = (origem: string, en: string, html = false) =>
    setRascunho((p) => ({ ...p, [chave(origem)]: html && htmlVazio(en) ? '' : en }));

  const salvar = () => {
    // Só guarda o que ainda é texto do orçamento (limpa traduções de textos que já não existem).
    const tipos = new Map(coletados.map((c) => [c.origem, c.tipo]));
    const textos: Record<string, string> = {};
    for (const [o, en] of Object.entries(rascunho)) {
      if (!tipos.has(o) || chave(en) === '') continue;
      if (tipos.get(o) === 'html' && htmlVazio(en)) continue;
      textos[o] = en;
    }
    onSave({ versao: 1, textos, traduzido_em: version.translations?.traduzido_em ?? new Date().toISOString(), modelo });
  };

  return (
    <Modal isOpen onClose={onClose} title="Traduzir e revisar (inglês)" maxWidth="max-w-4xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-lumos-text-secondary">
            Traduza com a IA e <span className="font-bold text-lumos-text-primary">revise cada texto</span> antes de salvar.
            O PDF em inglês usa o que estiver salvo aqui; texto sem tradução sai em português.
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={traduzindo || faltam.length === 0} onClick={() => traduzirComIA(true)}
              className="btn-primary h-9 px-3 text-xs font-bold flex items-center gap-1.5 disabled:opacity-50">
              {traduzindo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Traduzir {faltam.length > 0 ? `${faltam.length} faltante(s)` : 'com IA'}
            </button>
            <button type="button" disabled={traduzindo || coletados.length === 0}
              onClick={() => { if (confirm('Traduzir TUDO de novo? As traduções que você já editou serão substituídas.')) void traduzirComIA(false); }}
              className="btn-secondary h-9 px-3 text-xs font-bold disabled:opacity-50">
              Retraduzir tudo
            </button>
          </div>
        </div>

        {coletados.length === 0 && (
          <p className="text-sm text-lumos-text-secondary">Este orçamento ainda não tem textos para traduzir.</p>
        )}

        <div className="max-h-[60vh] overflow-y-auto pr-1 space-y-3">
          {coletados.map((c) => {
            const falta = chave(rascunho[c.origem]) === '';
            return (
              <div key={c.origem} className={clsx('grid grid-cols-1 md:grid-cols-2 gap-3 rounded-lumos border p-3',
                falta ? 'border-amber-500/40' : 'border-lumos-border')}>
                <div>
                  <span className="text-[10px] text-lumos-text-secondary font-black uppercase block mb-1">Original (português)</span>
                  <p className="text-sm text-lumos-text-primary whitespace-pre-wrap">{c.tipo === 'html' ? textoSimples(c.origem) : c.origem}</p>
                </div>
                <div>
                  <span className="text-[10px] text-lumos-text-secondary font-black uppercase block mb-1">
                    English {falta && <span className="text-amber-500 normal-case">· sem tradução</span>}
                  </span>
                  {c.tipo === 'html' ? (
                    <RichTextEditor value={rascunho[c.origem] ?? ''} onChange={(html: string) => mudar(c.origem, html, true)} editable minHeight={120} />
                  ) : (
                    <textarea rows={c.origem.length > 60 ? 3 : 1} className="input-lumos w-full text-sm"
                      value={rascunho[c.origem] ?? ''} onChange={(e) => mudar(c.origem, e.target.value)} />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary flex-1 h-10 text-sm">Cancelar</button>
          <button type="button" onClick={salvar} className="btn-primary flex-1 h-10 text-sm font-bold">Salvar traduções</button>
        </div>
      </div>
    </Modal>
  );
}
