import { useTheme } from '@/context/ThemeContext';
import { clsx } from 'clsx';

interface ThemeToggleProps {
  showDescription?: boolean;
}

export default function ThemeToggle({ showDescription = false }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="flex items-center justify-between px-3 py-2.5 rounded-lumos hover:bg-lumos-text-secondary/5 transition-all group w-full">
      <div className="flex flex-col">
        <span className="text-sm font-bold text-lumos-text-primary">Modo Escuro</span>
        {showDescription && (
          <p className="text-xs text-lumos-text-secondary">Alterna entre o tema claro e escuro</p>
        )}
      </div>
      
      <button 
        onClick={(e) => {
          e.preventDefault();
          toggleTheme();
        }}
        className={clsx(
          "relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 outline-none focus:ring-2 focus:ring-lumos-yellow focus:ring-offset-2",
          theme === 'dark' ? "bg-[#F5D87A]" : "bg-zinc-300 dark:bg-zinc-600"
        )}
        role="switch"
        aria-checked={theme === 'dark'}
      >
        <span
          className={clsx(
            "inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 shadow-sm",
            theme === 'dark' ? "translate-x-6" : "translate-x-1"
          )}
        />
      </button>
    </div>
  );
}
