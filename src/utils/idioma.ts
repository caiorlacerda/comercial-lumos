// Idioma do PDF da proposta e glossário de traduções, prontos para os INSERT/UPDATE
// de budget_versions (mesmo papel de camposDeMoeda). Sem imports.

export function camposDeIdioma(v?: { pdf_language?: string | null; translations?: unknown } | null) {
  return {
    pdf_language: v?.pdf_language === 'en' ? ('en' as const) : ('pt' as const),
    translations: (v?.translations ?? null) as { versao: 1; textos: Record<string, string>; traduzido_em?: string; modelo?: string } | null,
  };
}
