// Previsão do tempo pra diárias de gravação, via Open-Meteo (grátis, sem chave).
// Geocodifica o texto do local uma vez e busca a previsão diária da data.
// Só funciona pra datas dentro da janela de previsão (~16 dias).

export interface PrevisaoDia {
  chanceChuva: number;   // % (0-100)
  chuvaMm: number;
  tempMin: number;
  tempMax: number;
}

const geoCache = new Map<string, { lat: number; lon: number } | null>();

export async function geocode(local: string): Promise<{ lat: number; lon: number } | null> {
  const key = local.trim().toLowerCase();
  if (geoCache.has(key)) return geoCache.get(key)!;
  try {
    // O nome vem livre ("Praia da Reserva, RJ") — a primeira parte costuma ser
    // o que o geocoder entende melhor.
    const q = encodeURIComponent(local.split(/[,–-]/)[0].trim());
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=1&language=pt&format=json`);
    const j = await r.json();
    const hit = j?.results?.[0];
    const out = hit ? { lat: hit.latitude, lon: hit.longitude } : null;
    geoCache.set(key, out);
    return out;
  } catch {
    geoCache.set(key, null);
    return null;
  }
}

/** null = sem previsão (local não encontrado, data longe demais ou rede). */
export async function previsaoParaDiaria(local: string, dataISO: string): Promise<PrevisaoDia | null> {
  if (!local || !dataISO) return null;
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const alvo = new Date(dataISO + 'T12:00:00');
  const dias = Math.round((alvo.getTime() - hoje.getTime()) / 86400000);
  if (dias < 0 || dias > 15) return null;

  const geo = await geocode(local);
  if (!geo) return null;
  try {
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}` +
      `&daily=precipitation_probability_max,precipitation_sum,temperature_2m_max,temperature_2m_min` +
      `&timezone=America%2FSao_Paulo&start_date=${dataISO}&end_date=${dataISO}`
    );
    const j = await r.json();
    const d = j?.daily;
    if (!d?.time?.length) return null;
    return {
      chanceChuva: Math.round(d.precipitation_probability_max?.[0] ?? 0),
      chuvaMm: Number(d.precipitation_sum?.[0] ?? 0),
      tempMin: Math.round(d.temperature_2m_min?.[0] ?? 0),
      tempMax: Math.round(d.temperature_2m_max?.[0] ?? 0),
    };
  } catch {
    return null;
  }
}
