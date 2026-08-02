import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

// Fonte única dos dados da Wiki (espaços + páginas), compartilhada entre o painel
// de navegação (a árvore, no rail do app) e a página de conteúdo. Assim a árvore
// vive no MESMO painel das outras seções — sem sidebar próprio e sem "piscada" na
// troca de seção. O provider fica acima do conteúdo roteado (na Sidebar), então
// o estado sobrevive à navegação (reentrada instantânea).

export interface WikiSpace { id: string; name: string; icon: string | null; ordem: number; }
export interface WikiPage { id: string; space_id: string; parent_id: string | null; title: string; content: string; icon: string | null; ordem: number; updated_at: string; }

interface WikiCtx {
  spaces: WikiSpace[];
  activeSpace: WikiSpace | null;   // hoje a Wiki usa um espaço único
  pages: WikiPage[];
  loading: boolean;
  reload: () => void;
  createPage: (parentId: string | null) => Promise<void>;
  deletePage: (page: WikiPage) => Promise<boolean>;  // o caller confirma antes
}

// Cache em memória (por sessão de aba) pra reentrada instantânea, sem spinner.
let cachedSpaces: WikiSpace[] | null = null;
let cachedPages: WikiPage[] = [];

const Ctx = createContext<WikiCtx | null>(null);

export function WikiProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const onWiki = location.pathname.startsWith('/wiki');

  const [spaces, setSpaces] = useState<WikiSpace[]>(() => cachedSpaces ?? []);
  const [pages, setPages] = useState<WikiPage[]>(() => cachedPages);
  const [loading, setLoading] = useState(() => cachedSpaces === null);

  const loadSpaces = useCallback(async (): Promise<WikiSpace[]> => {
    const { data } = await supabase.from('wiki_spaces').select('*').order('ordem').order('created_at');
    const sp = (data as WikiSpace[]) || [];
    cachedSpaces = sp; setSpaces(sp); setLoading(false);
    return sp;
  }, []);

  const loadPages = useCallback(async (spaceId: string) => {
    const { data } = await supabase.from('wiki_pages').select('*').eq('space_id', spaceId).order('ordem').order('created_at');
    const ps = (data as WikiPage[]) || [];
    cachedPages = ps; setPages(ps);
  }, []);

  const reload = useCallback(() => {
    loadSpaces().then(sp => { if (sp[0]) loadPages(sp[0].id); });
  }, [loadSpaces, loadPages]);

  // Carrega/revalida ao entrar na Wiki. O cache já pinta a tela na hora.
  useEffect(() => {
    if (!onWiki) return;
    loadSpaces().then(sp => { if (sp[0]) loadPages(sp[0].id); });
  }, [onWiki, loadSpaces, loadPages]);

  const createPage = useCallback(async (parentId: string | null) => {
    const space = cachedSpaces?.[0];
    if (!space) return;
    const siblings = cachedPages.filter(p => p.parent_id === parentId);
    const { data } = await supabase.from('wiki_pages').insert([{
      space_id: space.id, parent_id: parentId, title: 'Sem título', content: '', ordem: siblings.length, created_by: profile?.id,
    }]).select('*').single();
    if (data) {
      await loadPages(space.id);
      navigate(`/wiki/${(data as WikiPage).id}`, { state: { edit: true } });
    }
  }, [profile?.id, loadPages, navigate]);

  const deletePage = useCallback(async (page: WikiPage): Promise<boolean> => {
    const { error } = await supabase.from('wiki_pages').delete().eq('id', page.id);
    if (error) return false;
    const space = cachedSpaces?.[0];
    if (space) await loadPages(space.id);
    return true;
  }, [loadPages]);

  const activeSpace = spaces[0] ?? null;

  return (
    <Ctx.Provider value={{ spaces, activeSpace, pages, loading, reload, createPage, deletePage }}>
      {children}
    </Ctx.Provider>
  );
}

export function useWiki() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useWiki precisa estar dentro de <WikiProvider>');
  return ctx;
}
