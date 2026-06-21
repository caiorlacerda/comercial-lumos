import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useLayout } from '@/context/LayoutContext';
import { getSectionItems } from '@/lib/navigation';
import { clsx } from 'clsx';

export default function MobileSubNav() {
  const { activeSection } = useLayout();
  const { can, isAdmin } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const items = getSectionItems(activeSection, { can, isAdmin });
  if (items.length <= 1) return null;

  return (
    <div className="lg:hidden sticky top-[calc(env(safe-area-inset-top)+48px)] z-30 bg-lumos-bg/95 backdrop-blur-sm border-b border-lumos-border">
      <div className="flex gap-2 overflow-x-auto no-scrollbar px-4 py-2">
        {items.map(item => {
          // Strict end path matching or prefix matching
          const isActive = item.end ? location.pathname === item.path : location.pathname.startsWith(item.path);
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all flex-shrink-0 cursor-pointer',
                isActive
                  ? 'bg-lumos-yellow text-black'
                  : 'bg-lumos-surface text-lumos-text-secondary border border-lumos-border'
              )}
            >
              <item.icon className="w-3.5 h-3.5" />
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
