// Converte um link de vídeo (YouTube ou Google Drive) na URL de embed do player.
// Retorna null se não reconhecer (aí a UI mostra como link simples).
export function getVideoEmbed(url: string | null | undefined): { embedUrl: string } | null {
  if (!url) return null;
  const u = url.trim();

  // YouTube: watch?v=, youtu.be/, embed/, shorts/
  const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (yt) return { embedUrl: `https://www.youtube.com/embed/${yt[1]}` };

  // Google Drive: /file/d/<id>/...
  const gd = u.match(/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/);
  if (gd) return { embedUrl: `https://drive.google.com/file/d/${gd[1]}/preview` };

  return null;
}
