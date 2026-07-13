import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

// "Voltar" inteligente: volta para a página anterior quando há histórico dentro
// do app; se a pessoa chegou por link direto (aba nova, sem histórico), cai em
// uma página padrão da seção em vez de sair do app ou não fazer nada.
// O React Router guarda um `idx` no history.state: 0 = primeira entrada da sessão.
export function useGoBack(fallback: string = '/') {
  const navigate = useNavigate();
  return useCallback(() => {
    const idx = (window.history.state as any)?.idx;
    if (typeof idx === 'number' && idx > 0) navigate(-1);
    else navigate(fallback);
  }, [navigate, fallback]);
}
