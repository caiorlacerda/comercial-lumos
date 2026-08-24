import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

/**
 * O navegador NÃO pode cachear resposta de API.
 *
 * Um erro momentâneo do servidor (ex.: o 300 de relação ambígua que apareceu
 * quando uma FK ficou duplicada) é uma resposta cacheável pelo padrão HTTP:
 * ela gruda no cache de disco daquela URL exata e a tela continua exibindo o
 * erro mesmo depois do banco corrigido — sobrevivendo a recarregar, limpar
 * dados do site e até reiniciar a máquina, e afetando só quem tinha aquela
 * URL específica em cache (foi o caso de um único projeto ficar vazio).
 * Com no-store, toda leitura vai ao servidor e o dado na tela é o dado real.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
  },
});
