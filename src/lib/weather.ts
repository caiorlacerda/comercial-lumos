// Previsão do tempo pra diárias de gravação. Geocodifica o endereço/local uma
// vez (Nominatim/OpenStreetMap — grátis, sem chave, e entende endereço de rua
// de verdade, diferente do geocoder por nome de lugar do Open-Meteo) e busca
// a previsão diária no Open-Meteo (grátis, sem chave). Só funciona pra datas
// dentro da janela de previsão (~15 dias).

export interface PrevisaoDia {
  chanceChuva: number;   // % (0-100)
  chuvaMm: number;
  tempMin: number;
  tempMax: number;
}

export type MotivoSemPrevisao = 'fora_da_janela' | 'endereco_nao_encontrado' | 'erro';
export interface ResultadoPrevisao { dados: PrevisaoDia | null; motivo?: MotivoSemPrevisao }

const geoCache = new Map<string, { lat: number; lon: number } | null>();

export async function geocode(local: string): Promise<{ lat: number; lon: number } | null> {
  const key = local.trim().toLowerCase();
  if (geoCache.has(key)) return geoCache.get(key)!;
  try {
    const q = encodeURIComponent(`${local.trim()}, Brasil`);
    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=br`);
    const j = await r.json();
    const hit = j?.[0];
    const out = hit ? { lat: Number(hit.lat), lon: Number(hit.lon) } : null;
    geoCache.set(key, out);
    return out;
  } catch {
    geoCache.set(key, null);
    return null;
  }
}

export async function previsaoParaDiaria(local: string, dataISO: string): Promise<ResultadoPrevisao> {
  if (!local || !dataISO) return { dados: null, motivo: 'erro' };
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const alvo = new Date(dataISO + 'T12:00:00');
  const dias = Math.round((alvo.getTime() - hoje.getTime()) / 86400000);
  if (dias < 0 || dias > 15) return { dados: null, motivo: 'fora_da_janela' };

  const geo = await geocode(local);
  if (!geo) return { dados: null, motivo: 'endereco_nao_encontrado' };
  try {
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}` +
      `&daily=precipitation_probability_max,precipitation_sum,temperature_2m_max,temperature_2m_min` +
      `&timezone=America%2FSao_Paulo&start_date=${dataISO}&end_date=${dataISO}`
    );
    const j = await r.json();
    const d = j?.daily;
    if (!d?.time?.length) return { dados: null, motivo: 'erro' };
    return {
      dados: {
        chanceChuva: Math.round(d.precipitation_probability_max?.[0] ?? 0),
        chuvaMm: Number(d.precipitation_sum?.[0] ?? 0),
        tempMin: Math.round(d.temperature_2m_min?.[0] ?? 0),
        tempMax: Math.round(d.temperature_2m_max?.[0] ?? 0),
      },
    };
  } catch {
    return { dados: null, motivo: 'erro' };
  }
}
