import { useMemo, useState } from 'react';
import Select from '@/components/ui/Select';
import type { BudgetItem, BudgetVersion } from '@/utils/financials';
import { coletarTextos, faltantes, type Traducoes } from '@/lib/traducaoCore';
import TraducaoModal from '@/components/editor/TraducaoModal';

interface Props {
  version: BudgetVersion;
  items: BudgetItem[];
  /** Versão antiga / só leitura. */
  disabled: boolean;
  onChange: (updates: Partial<BudgetVersion>) => void;
}

export default function IdiomaPanel({ version, items, disabled, onChange }: Props) {
  const [aberto, setAberto] = useState(false);
  const idioma = version.pdf_language === 'en' ? 'en' : 'pt';
  const coletados = useMemo(() => coletarTextos(version, items), [version, items]);
  const faltam = faltantes(coletados, version.translations).length;

  const salvar = (t: Traducoes) => {
    onChange({ translations: t });
    setAberto(false);
  };

  return (
    <div className="space-y-2">
      <div>
        <label className="text-[10px] text-lumos-text-secondary font-black uppercase mb-1 block">Idioma do PDF</label>
        <Select
          disabled={disabled}
          className="input-lumos w-full font-black uppercase text-[10px] disabled:opacity-70"
          value={idioma}
          onChange={(v) => onChange({ pdf_language: v === 'en' ? 'en' : 'pt' })}
          options={[{ value: 'pt', label: 'Português' }, { value: 'en', label: 'English (US)' }]}
        />
      </div>

      {idioma === 'en' && (
        <div className="rounded-lumos border border-lumos-border p-3 space-y-2 text-[10px] font-semibold">
          <div className="flex items-center justify-between gap-2">
            <span className="text-lumos-text-secondary">
              {coletados.length === 0
                ? 'Sem textos para traduzir.'
                : `${coletados.length - faltam} de ${coletados.length} textos traduzidos`}
            </span>
            <button
              type="button" disabled={disabled} onClick={() => setAberto(true)}
              className="h-8 px-3 rounded-lumos border border-lumos-border text-lumos-text-primary font-bold hover:border-lumos-yellow/50 disabled:opacity-50"
            >
              Traduzir e revisar
            </button>
          </div>
          {faltam > 0 && (
            <p className="text-amber-500">
              {faltam} texto(s) sem tradução saem em português no PDF em inglês.
            </p>
          )}
        </div>
      )}

      {aberto && <TraducaoModal version={version} items={items} onClose={() => setAberto(false)} onSave={salvar} />}
    </div>
  );
}
