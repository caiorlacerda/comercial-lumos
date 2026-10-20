// Fontes do visual do pitch deck da Lumos (DM Sans + Instrument Serif nos títulos + JetBrains Mono). Carregadas só nas
// telas que usam esse visual (login e Home), para o resto do app não pagar por elas.
const FONTES = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300..700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400..600&display=swap';

export function carregarFontesDeck() {
  if (typeof document === 'undefined' || document.getElementById('fontes-deck')) return;
  const link = document.createElement('link');
  link.id = 'fontes-deck';
  link.rel = 'stylesheet';
  link.href = FONTES;
  document.head.appendChild(link);
}
