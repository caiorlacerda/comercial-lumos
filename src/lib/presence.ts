// Presença com fallback: quando o WebSocket de tempo real não conecta (proxy,
// muitas abas, rede corporativa), usamos o last_seen gravado no banco pra saber
// quem está ativo. "Online" = presença ao vivo OU visto nos últimos ~2 min.

export const ONLINE_WINDOW_MS = 2 * 60 * 1000;

export function isRecent(lastSeen?: string | null, withinMs = ONLINE_WINDOW_MS): boolean {
  if (!lastSeen) return false;
  const t = new Date(lastSeen).getTime();
  return !Number.isNaN(t) && Date.now() - t <= withinMs;
}

// Combina a presença ao vivo (WebSocket) com o fallback por last_seen.
// Se o realtime está funcionando (live !== 'offline'), usa ele (online/away/busy).
// Senão, cai pro last_seen: recente => 'online', caso contrário 'offline'.
export function effectiveStatus(live: string | undefined, lastSeen?: string | null): string {
  if (live && live !== 'offline') return live;
  return isRecent(lastSeen) ? 'online' : 'offline';
}
