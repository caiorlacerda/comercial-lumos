import { LayoutGrid, List as ListIcon } from 'lucide-react';
import { clsx } from 'clsx';

export type ViewMode = 'grid' | 'list';

// Alternador Lista/Cards padrão da plataforma. Lista vem primeiro (é a visão
// prioritária). Guarde a escolha por página com um localStorage próprio.
export default function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="flex bg-lumos-surface border border-lumos-border p-1 rounded-lumos">
      <button onClick={() => onChange('list')} title="Lista"
        className={clsx('p-2 rounded-sm transition-all', value === 'list' ? 'bg-lumos-yellow text-black shadow-sm' : 'text-lumos-text-secondary hover:text-lumos-text-primary')}>
        <ListIcon className="w-4 h-4" />
      </button>
      <button onClick={() => onChange('grid')} title="Cards"
        className={clsx('p-2 rounded-sm transition-all', value === 'grid' ? 'bg-lumos-yellow text-black shadow-sm' : 'text-lumos-text-secondary hover:text-lumos-text-primary')}>
        <LayoutGrid className="w-4 h-4" />
      </button>
    </div>
  );
}
