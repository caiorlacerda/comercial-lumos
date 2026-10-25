import { clsx } from 'clsx';
import UserAvatar from '@/components/common/UserAvatar';
import type { Pessoa } from '@/lib/colaboracao/presenca';

/** Quem mais está com este documento aberto: avatares com o anel na cor da pessoa e o nome ao passar o mouse. */
export default function PresencaNoDocumento({ pessoas, rotuloCampo, className }: {
  pessoas: Pessoa[];
  /** Traduz o id do campo ("item:abc") em texto ("Item Câmera"); sem ele mostra só o nome. */
  rotuloCampo?: (campo: string) => string | null;
  className?: string;
}) {
  if (pessoas.length === 0) return null;
  const visiveis = pessoas.slice(0, 4);
  const resto = pessoas.length - visiveis.length;
  const nomes = pessoas.map(p => p.nome.split(' ')[0]);
  const frase = nomes.length === 1 ? `${nomes[0]} também está aqui`
    : nomes.length === 2 ? `${nomes[0]} e ${nomes[1]} também estão aqui`
    : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]} também estão aqui`;
  return (
    <div className={clsx('flex items-center gap-2', className)} role="status" aria-live="polite">
      <div className="flex -space-x-2">
        {visiveis.map(p => {
          const onde = p.campo ? rotuloCampo?.(p.campo) : null;
          return (
            <span key={p.userId} className="relative rounded-full ring-2" style={{ ['--tw-ring-color' as any]: p.cor }}
              title={`${p.nome}${onde ? ` · editando ${onde}` : ' · só olhando'}`}>
              <UserAvatar user={{ id: p.userId, full_name: p.nome, avatar_url: p.avatar }} size={28} />
              {p.campo && <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-lumos-surface" style={{ background: p.cor }} />}
            </span>
          );
        })}
        {resto > 0 && <span className="flex h-7 w-7 items-center justify-center rounded-full bg-lumos-text-primary/10 text-[10px] font-black text-lumos-text-primary ring-2 ring-lumos-surface">+{resto}</span>}
      </div>
      <span className="hidden whitespace-nowrap text-[11px] font-bold text-lumos-text-secondary 2xl:inline">{frase}</span>
    </div>
  );
}

/** Etiqueta que aparece sobre o campo/linha que outra pessoa está editando. */
export function EtiquetaDeEdicao({ pessoa }: { pessoa: Pessoa }) {
  return (
    <span className="pointer-events-none absolute -top-2.5 right-3 z-10 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-white shadow"
      style={{ background: pessoa.cor }}>
      {pessoa.nome.split(' ')[0]} editando
    </span>
  );
}
