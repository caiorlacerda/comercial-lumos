// Formatação de EXIBIÇÃO padronizada, independente de como o dado foi digitado.
// Não altera o que está salvo no banco — só normaliza o que aparece na tela.

const LOWER = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'du']);

// Nome em Caixa Alta/Título consistente: "joão DA silva" -> "João da Silva".
// Preserva siglas curtas em maiúsculo (ex.: "JBS", "MK").
export function formatName(raw?: string | null): string {
  if (!raw) return '';
  const words = raw.trim().replace(/\s+/g, ' ').split(' ');
  return words
    .map((w, i) => {
      if (w.length <= 3 && w === w.toUpperCase() && /[A-ZÀ-Ú]/.test(w)) return w; // sigla (JBS)
      const lw = w.toLowerCase();
      if (i > 0 && LOWER.has(lw)) return lw;
      return lw.charAt(0).toUpperCase() + lw.slice(1);
    })
    .join(' ');
}

// CPF (000.000.000-00) ou CNPJ (00.000.000/0000-00), detectado pela qtd de dígitos.
export function formatDoc(raw?: string | null): string {
  if (!raw) return '';
  const d = raw.replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return raw.trim();
}

// Telefone BR: (11) 91234-5678 ou (11) 1234-5678. Ignora +55 e caracteres soltos.
export function formatPhone(raw?: string | null): string {
  if (!raw) return '';
  let d = raw.replace(/\D/g, '');
  if ((d.length === 13 || d.length === 12) && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return raw.trim();
}
