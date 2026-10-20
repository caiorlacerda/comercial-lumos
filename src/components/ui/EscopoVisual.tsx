import React from 'react';
import { useVisualNovo } from '@/lib/visualNovo';

// Janelas e menus são desenhados num portal direto no <body>, fora do escopo `.lumos-deck` do
// conteúdo. Este envelope devolve o escopo (cores legíveis no tema claro, fonte e fundo sólido)
// só quando o visual novo está ligado. Desligado, não muda nada.
export default function EscopoVisual({ children }: { children: React.ReactNode }) {
  const visualNovo = useVisualNovo();
  return visualNovo ? <div className="lumos-deck">{children}</div> : <>{children}</>;
}
