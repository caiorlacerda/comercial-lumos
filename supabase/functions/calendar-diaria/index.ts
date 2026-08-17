// Diária de gravação ⇄ Google Calendar da produção.
//
// Usa a MESMA conexão OAuth do get-calendar-events (tabela google_calendar_auth,
// escopo completo de calendar) e o mesmo GOOGLE_CALENDAR_ID. Cria/atualiza o
// evento como dia inteiro e devolve o event id, que o app guarda na diária.
//
// POST { action: 'upsert', diaria_id } → cria/atualiza o evento da diária
// POST { action: 'delete', event_id }  → remove o evento
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

async function accessToken(db: ReturnType<typeof createClient>): Promise<string> {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID') ?? ''
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? ''
  const { data: auth } = await db.from('google_calendar_auth')
    .select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (!auth?.refresh_token) throw new Error('Google Calendar não conectado (google_calendar_auth vazio)')

  const expira = auth.expires_at ? new Date(auth.expires_at).getTime() : 0
  if (auth.access_token && expira > Date.now() + 120_000) return auth.access_token

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: auth.refresh_token, grant_type: 'refresh_token',
    }),
  })
  if (!r.ok) throw new Error(`refresh falhou: ${await r.text()}`)
  const t = await r.json()
  await db.from('google_calendar_auth').update({
    access_token: t.access_token,
    expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', auth.id)
  return t.access_token
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'use POST' }, 405)

  try {
    const body = await req.json()
    const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const calendarId = Deno.env.get('GOOGLE_CALENDAR_ID') ?? ''
    if (!calendarId) return json({ error: 'GOOGLE_CALENDAR_ID ausente' }, 500)
    const token = await accessToken(db)
    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
    const gauth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

    if (body.action === 'delete') {
      if (!body.event_id) return json({ error: 'event_id obrigatório' }, 400)
      const r = await fetch(`${base}/${encodeURIComponent(body.event_id)}`, { method: 'DELETE', headers: gauth })
      // 404/410 = já não existe; missão cumprida do mesmo jeito
      if (!r.ok && r.status !== 404 && r.status !== 410) return json({ error: `delete falhou ${r.status}` }, 502)
      return json({ ok: true })
    }

    if (body.action !== 'upsert' || !body.diaria_id) return json({ error: 'action upsert + diaria_id' }, 400)

    const { data: d } = await db.from('project_diarias')
      .select('*')
      .eq('id', body.diaria_id).maybeSingle()
    if (!d) return json({ error: 'diária não encontrada' }, 404)
    if (!d.data) return json({ ok: true, skipped: 'sem data, nada a agendar' })

    const { data: proj } = await db.from('projects').select('name, code').eq('id', d.project_id).maybeSingle()

    // Com horário vira compromisso com hora; sem, evento de dia inteiro
    // (end de dia inteiro é exclusivo, por isso o +1 dia).
    const TZ = 'America/Sao_Paulo'
    const hIni = (d.hora_inicio as string | null)?.slice(0, 5) ?? null
    const hFim = (d.hora_fim as string | null)?.slice(0, 5) ?? null
    const comHora = !!(hIni && hFim)
    const fimDia = new Date(new Date(d.data + 'T12:00:00').getTime() + 86400000).toISOString().slice(0, 10)
    const evento = {
      summary: `🎬 ${d.nome}${proj?.name ? ` — ${proj.name}` : ''}`,
      description:
        `Diária de gravação${proj?.code ? ` · ${proj.code}` : ''}\n` +
        `Duração prevista: ${Number(d.duracao_horas).toLocaleString('pt-BR')}h\n` +
        (d.descricao ? `\n${d.descricao}\n` : '') +
        `\nCriado pelo app Lumos (aba Diárias do projeto).`,
      ...(d.local ? { location: d.local } : {}),
      start: comHora ? { dateTime: `${d.data}T${hIni}:00`, timeZone: TZ } : { date: d.data },
      end: comHora ? { dateTime: `${d.data}T${hFim}:00`, timeZone: TZ } : { date: fimDia },
    }

    let eventId = d.google_event_id as string | null
    let r: Response
    if (eventId) {
      r = await fetch(`${base}/${encodeURIComponent(eventId)}`, { method: 'PATCH', headers: gauth, body: JSON.stringify(evento) })
      // Evento sumiu do calendário (apagado à mão)? Recria.
      if (r.status === 404 || r.status === 410) eventId = null
    }
    if (!eventId) {
      r = await fetch(base, { method: 'POST', headers: gauth, body: JSON.stringify(evento) })
    }
    if (!r!.ok) return json({ error: `calendar respondeu ${r!.status}: ${(await r!.text()).slice(0, 180)}` }, 502)
    const saved = await r!.json()

    await db.from('project_diarias').update({ google_event_id: saved.id }).eq('id', d.id)
    return json({ ok: true, event_id: saved.id })
  } catch (err) {
    return json({ error: String((err as Error)?.message || err).slice(0, 300) }, 500)
  }
})
