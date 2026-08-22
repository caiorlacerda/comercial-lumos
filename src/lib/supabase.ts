import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

/**
 * O navegador NÃO pode cachear resposta de API.
 *
 * Um erro momentâneo do servidor é uma resposta cacheável pelo padrão HTTP:
 * ela gruda no cache de disco daquela URL exata e a tela continua exibindo o
 * erro mesmo depois do banco corrigido — sobrevivendo a recarregar, limpar
 * dados do site e até reiniciar a máquina, e afetando só quem tinha aquela
 * URL em cache (um projeto ficou com os custos zerados por causa disso).
 * Com no-store, toda leitura vai ao servidor e a tela mostra o dado real.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
  },
});
