import { useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/** Campo de senha com o olhinho para mostrar/esconder o que foi digitado. */
export default function SenhaInput({ className = '', ...resto }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visivel, setVisivel] = useState(false);
  return (
    <div className="relative">
      <input {...resto} type={visivel ? 'text' : 'password'} className={`${className} pr-12`} />
      <button
        type="button"
        onClick={() => setVisivel(v => !v)}
        aria-label={visivel ? 'Esconder a senha' : 'Mostrar a senha'}
        title={visivel ? 'Esconder a senha' : 'Mostrar a senha'}
        tabIndex={-1}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-current opacity-60 hover:opacity-100 transition-opacity"
      >
        {visivel ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
      </button>
    </div>
  );
}
