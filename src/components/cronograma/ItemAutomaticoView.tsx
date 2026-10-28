import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { Zap } from 'lucide-react';
import { tipoDoItem } from '@/lib/cronograma';
import type { ItemAutomatico } from '@/lib/cronogramaAutomatico';

/** Um item que o cronograma trouxe sozinho (diária ou entrega): tracejado, sem edição; clicar abre o projeto. */
export default function ItemAutomaticoView({ item }: { item: ItemAutomatico }) {
  const navigate = useNavigate();
  const t = tipoDoItem(item.tipo);
  const origem = item.linhaTipo === 'externas' ? 'da diária' : 'da entrega';
  return (
    <button type="button" onClick={() => navigate(item.link)}
      title={`Automático, ${origem} no projeto. Para mudar, edite lá. Clique para abrir.`}
      className={clsx('w-full flex items-start gap-1.5 rounded border border-dashed px-1.5 py-1 text-left hover:border-lumos-yellow/60 transition-colors', t.caixa)}>
      <Zap className="mt-[2px] w-2.5 h-2.5 flex-shrink-0 text-lumos-text-secondary" />
      <span className="min-w-0 flex-1 text-[12px] leading-snug text-lumos-text-primary whitespace-pre-wrap break-words">{item.texto}</span>
    </button>
  );
}
