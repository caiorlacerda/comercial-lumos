import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/**
 * MODO APRESENTAÇÃO (valores ocultos) — o "olho" dos apps de banco: um clique
 * some com TODOS os números de dinheiro da tela, outro clique traz de volta.
 * Serve pra mostrar a plataforma sem expor faturamento, custo ou margem.
 *
 * Como cobre o app inteiro sem marcar tela por tela: quando está ligado, um
 * observador varre o texto da página e borra os pedaços que são valor em R$
 * (e, dentro do Financeiro, também os percentuais, que são margem e markup).
 * O conteúdo continua no DOM, isso é privacidade visual pra apresentação,
 * não segurança contra quem inspeciona a página.
 */

const CHAVE = 'lumos_valores_ocultos';
const CLASSE = 'lumos-valor-oculto';

// "R$ 1.234,56", "-R$ 90,00", "R$ 0"
const MOEDA = /R\$\s*-?[\d.,]+/;
// "38,5%", "-12%" — só dentro do Financeiro, pra não borrar barra de progresso
const PERCENTUAL = /-?\d+([.,]\d+)?\s*%/;

interface PrivacyCtx {
  ocultarValores: boolean;
  toggleValores: () => void;
}

const Ctx = createContext<PrivacyCtx>({ ocultarValores: false, toggleValores: () => {} });

export const usePrivacy = () => useContext(Ctx);

export function PrivacyProvider({ children }: { children: React.ReactNode }) {
  const [ocultarValores, setOcultar] = useState(() => {
    try { return localStorage.getItem(CHAVE) === '1'; } catch { return false; }
  });
  const marcadosRef = useRef<Set<Element>>(new Set());

  const toggleValores = useCallback(() => {
    setOcultar(v => {
      const novo = !v;
      try { localStorage.setItem(CHAVE, novo ? '1' : '0'); } catch { /* modo privado do navegador */ }
      return novo;
    });
  }, []);

  useEffect(() => {
    const raiz = document.documentElement;
    const limpar = () => {
      marcadosRef.current.forEach(el => el.classList.remove(CLASSE));
      marcadosRef.current.clear();
    };

    if (!ocultarValores) {
      delete raiz.dataset.valoresOcultos;
      limpar();
      return;
    }
    raiz.dataset.valoresOcultos = '1';

    const varrer = () => {
      // Percentual é sensível no Financeiro (margem, markup); fora dali é
      // progresso de projeto e afins, que podem continuar à vista.
      const noFinanceiro = window.location.pathname.startsWith('/financeiro');
      const alvo = document.getElementById('root') || document.body;
      const novos = new Set<Element>();

      const ehValor = (texto: string) =>
        MOEDA.test(texto) || (noFinanceiro && PERCENTUAL.test(texto));

      // 1) Elementos que só têm texto. Pega também o caso comum do React
      // quebrar "{valor}%" em dois pedaços de texto irmãos.
      const elementos = document.createTreeWalker(alvo, NodeFilter.SHOW_ELEMENT);
      for (let el = elementos.nextNode() as Element | null; el; el = elementos.nextNode() as Element | null) {
        if (el.childElementCount === 0 && ehValor(el.textContent || '')) novos.add(el);
      }

      // 2) Texto solto ao lado de outros elementos: aí o valor mora no pai.
      const textos = document.createTreeWalker(alvo, NodeFilter.SHOW_TEXT);
      for (let no = textos.nextNode(); no; no = textos.nextNode()) {
        const el = no.parentElement;
        if (!el || novos.has(el) || el.childElementCount === 0) continue;
        if (ehValor(no.nodeValue || '')) novos.add(el);
      }

      // Campos de formulário guardam o valor em value, não em texto.
      document.querySelectorAll<HTMLInputElement>('input').forEach(input => {
        if (MOEDA.test(input.value || '')) novos.add(input);
      });

      marcadosRef.current.forEach(el => { if (!novos.has(el)) el.classList.remove(CLASSE); });
      novos.forEach(el => el.classList.add(CLASSE));
      marcadosRef.current = novos;
    };

    // Agenda uma varredura só por quadro, senão cada tecla digitada varreria
    // a página inteira.
    let agendado = 0;
    const agendar = () => {
      if (agendado) return;
      agendado = window.setTimeout(() => { agendado = 0; varrer(); }, 120);
    };

    varrer();
    const observer = new MutationObserver(agendar);
    observer.observe(document.getElementById('root') || document.body, {
      childList: true, subtree: true, characterData: true,
    });
    document.addEventListener('input', agendar, true);

    return () => {
      observer.disconnect();
      document.removeEventListener('input', agendar, true);
      if (agendado) clearTimeout(agendado);
      limpar();
      delete raiz.dataset.valoresOcultos;
    };
  }, [ocultarValores]);

  return <Ctx.Provider value={{ ocultarValores, toggleValores }}>{children}</Ctx.Provider>;
}
