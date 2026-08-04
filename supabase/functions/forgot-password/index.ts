import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// "Esqueci minha senha" — endpoint PÚBLICO (chamado da tela de login, sem sessão).
//
// Por que uma função e não o resetPasswordForEmail direto no cliente:
// o recovery do GoTrue NÃO chega em conta que nunca confirmou o e-mail (convite
// pendente/expirado) — justamente quem mais precisa. Aqui a gente decide:
//   • conta ativada  → e-mail de redefinição (link para /redefinir-senha)
//   • conta pendente → reinvita (apaga o auth órfão e manda convite novo,
//                      mesmo fluxo do "Reenviar acesso" do admin)
//   • e-mail desconhecido → responde o MESMO ok genérico (não vaza cadastro)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

// Resposta única para TODOS os desfechos (anti-enumeração de e-mails).
const GENERIC_OK = { ok: true }

async function findAuthUserByEmail(admin: any, email: string) {
  const target = email.trim().toLowerCase()
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error || !data) return null
    const found = data.users.find((u: any) => (u.email ?? '').toLowerCase() === target)
    if (found) return found
    if (data.users.length < 200) return null
  }
  return null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    const { email } = await req.json().catch(() => ({}))
    if (!email || typeof email !== 'string' || !email.includes('@') || email.length > 200) {
      return json(GENERIC_OK) // input torto: mesmo ok genérico
    }
    const origin = req.headers.get('origin') ?? 'https://app.produtoralumos.com.br'

    // Só age sobre gente do time (perfil ATIVO). Desconhecido/inativo: ok e fim.
    const { data: profile } = await admin
      .from('app_users')
      .select('id, full_name, role, job_title, status, auth_user_id')
      .ilike('email', email.trim())
      .maybeSingle()
    if (!profile || profile.status !== 'ativo') return json(GENERIC_OK)

    const authUser = await findAuthUserByEmail(admin, email)
    const confirmed = !!(authUser && (authUser.email_confirmed_at || authUser.last_sign_in_at))

    if (confirmed) {
      // Conta ativada: e-mail de redefinição padrão.
      const anonClient = createClient(SUPABASE_URL, ANON_KEY)
      await anonClient.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${origin}/redefinir-senha`,
      })
      return json(GENERIC_OK)
    }

    // Conta pendente (convite nunca aceito) ou auth ausente: reinvita.
    // Freio anti-abuso: se o convite pendente foi (re)criado há menos de 10 min,
    // não recria — o e-mail recente ainda vale e ninguém força reenvio em loop.
    if (authUser) {
      const ageMs = Date.now() - new Date(authUser.created_at).getTime()
      if (ageMs < 10 * 60 * 1000) return json(GENERIC_OK)
      await admin.auth.admin.deleteUser(authUser.id).catch(() => {})
    }
    if (profile.auth_user_id && profile.auth_user_id !== authUser?.id) {
      await admin.auth.admin.deleteUser(profile.auth_user_id).catch(() => {})
    }

    const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email.trim(), {
      data: { full_name: profile.full_name, role: profile.role, job_title: profile.job_title },
      redirectTo: `${origin}/definir-senha`,
    })
    if (inviteError) {
      console.error('forgot-password: reinvite falhou', inviteError)
      return json(GENERIC_OK) // não vaza o motivo pro chamador
    }
    const newId = inviteData.user?.id
    if (newId) await admin.from('app_users').update({ auth_user_id: newId }).eq('id', profile.id)

    return json(GENERIC_OK)
  } catch (err) {
    console.error('forgot-password:', err)
    return json(GENERIC_OK) // até em erro interno a resposta é a mesma
  }
})
