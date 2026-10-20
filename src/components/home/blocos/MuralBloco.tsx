import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { MuralFeed } from '@/components/mural/MuralFeed';

/** Mural de Recados (feed do time). */
export default function MuralBloco() {
  const navigate = useNavigate();
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between pb-1.5">
        <h2 className="text-[11px] uppercase tracking-[3px] text-lumos-text-primary flex items-center gap-3">
          <span className="block h-2 w-2 bg-lumos-yellow" /> Mural de Recados
        </h2>
        <button
          onClick={() => navigate('/mural')}
          className="text-[10px] font-black uppercase tracking-wider text-lumos-text-secondary hover:text-lumos-yellow transition-colors flex items-center gap-1"
        >
          Ver tudo <ChevronRight className="w-3 h-3" />
        </button>
      </div>
      <MuralFeed limit={3} emptyHint="Nenhum recado ainda. Os avisos da administração aparecem aqui." />
    </div>
  );
}
