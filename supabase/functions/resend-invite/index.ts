import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
function errMsg(e: any): string {
  if (!e) return 'Erro desconhecido'
  if (typeof e === 'string') return e
  return e.message || e.error_description || e.error || e.msg || e.hint || e.details || JSON.stringify(e, Object.getOwnPropertyNames(e))
}

// Acha a conta de auth de um e-mail (fonte da verdade — o auth_user_id guardado
// pode estar defasado por reconvites).
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

// Reenvia o CONVITE (não recovery) para quem foi convidado mas não aceitou e o
// link expirou. O recovery (resetPasswordForEmail) não chega em conta ainda não
// confirmada, por isso aqui a gente reinvita de verdade: apaga a conta de auth
// pendente e chama inviteUserByEmail de novo (que envia o e-mail). O perfil em
// app_users é preservado (auth_user_id não tem FK/cascade) e só re-vinculado.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    // 1. Autoriza: só admin ativo.
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader) return json({ error: 'Não autenticado.' }, 401)
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data: { user: caller } } = await callerClient.auth.getUser()
    if (!caller) return json({ error: 'Sessão inválida.' }, 401)
    const { data: callerProfile } = await adminClient.from('app_users').select('id, role, status').eq('auth_user_id', caller.id).single()
    if (!callerProfile || callerProfile.role !== 'admin' || callerProfile.status !== 'ativo') {
      return json({ error: 'Apenas administradores podem reenviar convites.' }, 403)
    }

    // 2. Perfil alvo.
    const { id } = await req.json()
    if (!id) return json({ error: 'ID do usuário é obrigatório.' }, 400)
    const { data: profile, error: pErr } = await adminClient
      .from('app_users').select('id, email, full_name, role, job_title, auth_user_id').eq('id', id).single()
    if (pErr || !profile) return json({ error: 'Usuário não encontrado.' }, 404)

    // 3. Estado atual pela conta de auth do e-mail (fonte da verdade — o
    //    auth_user_id guardado pode estar defasado por reconvites anteriores).
    const authUser = await findAuthUserByEmail(adminClient, profile.email)
    if (authUser && (authUser.last_sign_in_at || authUser.email_confirmed_at)) {
      return json({ error: 'Este usuário já ativou o acesso — não precisa reenviar.', already: true }, 400)
    }
    // Apaga qualquer conta de auth pendente do e-mail (a achada e a apontada pelo
    // perfil, se diferentes) pra liberar um convite novo. O perfil é preservado.
    const toDelete = new Set<string>()
    if (authUser?.id) toDelete.add(authUser.id)
    if (profile.auth_user_id) toDelete.add(profile.auth_user_id)
    for (const aid of toDelete) {
      await adminClient.auth.admin.deleteUser(aid).catch(() => {})
    }

    // 4. Reinvita (envia o e-mail).
    const origin = req.headers.get('origin') ?? 'https://app.produtoralumos.com.br'
    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(profile.email, {
      data: { full_name: profile.full_name, role: profile.role, job_title: profile.job_title },
      redirectTo: `${origin}/definir-senha`,
    })
    if (inviteError) return json({ error: `Falha ao reenviar o convite: ${errMsg(inviteError)}` }, 400)

    // 5. Re-vincula o novo auth_user_id ao perfil existente.
    const newId = inviteData.user?.id
    if (newId) await adminClient.from('app_users').update({ auth_user_id: newId }).eq('id', profile.id)

    return json({ message: 'Convite reenviado com sucesso.' }, 200)
  } catch (error: any) {
    return json({ error: errMsg(error) }, 400)
  }
})
