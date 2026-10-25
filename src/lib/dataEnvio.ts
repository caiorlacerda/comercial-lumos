/** Data e hora do envio de um vídeo, para mostrar nas listas: "23/10 às 14:32" (com o ano se não for o atual). */
export const dataEnvio = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const dia = d.toLocaleDateString('pt-BR', d.getFullYear() === new Date().getFullYear()
    ? { day: '2-digit', month: '2-digit' }
    : { day: '2-digit', month: '2-digit', year: '2-digit' });
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${dia} às ${hora}`;
};

/** "hoje", "ontem", "há 5 dias", "há 2 meses". */
export const haQuanto = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const dias = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
  if (dias < 1) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;
  const m = Math.floor(dias / 30);
  return `há ${m} ${m === 1 ? 'mês' : 'meses'}`;
};

/** "Enviado por Fulano · 23/10 às 14:32" (sem o nome quando o Drive não informou quem enviou). */
export const textoEnvio = (uploadedAt: string | null | undefined, createdAt: string, uploadedBy?: string | null): string =>
  `Enviado${uploadedBy?.trim() ? ` por ${uploadedBy.trim()}` : ''} · ${dataEnvio(uploadedAt || createdAt)}`;
