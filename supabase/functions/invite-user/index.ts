import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Extrai uma mensagem legível de qualquer formato de erro (Error, AuthError,
// PostgrestError, string). JSON.stringify de um Error puro vira "{}", por isso
// usamos getOwnPropertyNames para capturar message/stack não-enumeráveis.
function errMsg(e: any): string {
  if (!e) return 'Erro desconhecido'
  if (typeof e === 'string') return e
  return (
    e.message || e.error_description || e.error || e.msg || e.hint || e.details ||
    JSON.stringify(e, Object.getOwnPropertyNames(e))
  )
}

// Acha a conta de auth de um e-mail (a fonte da verdade — o auth_user_id guardado
// em app_users pode estar defasado por reconvites). Pagina a lista de usuários.
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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    // 1. Autoriza: só um admin ativo pode convidar usuários.
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader) return json({ error: 'Não autenticado.' }, 401)

    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser()
    if (callerErr || !caller) return json({ error: 'Sessão inválida.' }, 401)

    const { data: callerProfile } = await adminClient
      .from('app_users')
      .select('id, role, status')
      .eq('auth_user_id', caller.id)
      .single()

    if (!callerProfile || callerProfile.role !== 'admin' || callerProfile.status !== 'ativo') {
      return json({ error: 'Apenas administradores podem convidar usuários.' }, 403)
    }

    // 2. Valida o payload.
    const { email, full_name, role, job_title } = await req.json()
    if (!email || !full_name || !role) {
      return json({ error: 'E-mail, nome e cargo são obrigatórios.' }, 400)
    }

    // 2.5 Já existe perfil com este e-mail? Não duplica — manda usar "Reenviar acesso".
    const { data: existingProfile } = await adminClient
      .from('app_users').select('id, full_name').ilike('email', email).maybeSingle()
    if (existingProfile) {
      return json({ error: `Já existe um usuário com este e-mail (${existingProfile.full_name}). Abra o perfil dele e use "Reenviar acesso".` }, 400)
    }

    // 2.6 Limpa conta de auth órfã (e-mail registrado mas SEM perfil — sobra de
    //     uma exclusão/reconvite antigos). Sem isso, o inviteUserByEmail falha com
    //     "A user with this email address has already been registered".
    const orphan = await findAuthUserByEmail(adminClient, email)
    if (orphan) {
      const { error: delErr } = await adminClient.auth.admin.deleteUser(orphan.id)
      if (delErr) return json({ error: `Não foi possível liberar o e-mail (conta antiga): ${errMsg(delErr)}` }, 400)
    }

    // 3. Envia o convite (o usuário define a própria senha ao aceitar).
    const origin = req.headers.get('origin') ?? 'https://app.produtoralumos.com.br'
    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { full_name, role, job_title },
      redirectTo: `${origin}/definir-senha`,
    })
    if (inviteError) {
      return json({ error: `Falha ao enviar o convite: ${errMsg(inviteError)}` }, 400)
    }

    const invitedUserId = inviteData.user?.id
    if (!invitedUserId) return json({ error: 'Falha ao criar a conta convidada.' }, 400)

    // 4. Cria o perfil em app_users (atômico com o convite). Se falhar,
    //    remove o usuário de auth para não deixar conta órfã.
    const { error: profileError } = await adminClient.from('app_users').insert([{
      auth_user_id: invitedUserId,
      full_name,
      email,
      role,
      job_title: job_title ?? null,
      status: 'ativo',
      invited_by: callerProfile.id,
    }])

    if (profileError) {
      await adminClient.auth.admin.deleteUser(invitedUserId)
      return json({ error: `Erro ao criar perfil: ${errMsg(profileError)}` }, 400)
    }

    return json({ message: 'Convite enviado com sucesso', user: inviteData.user }, 200)
  } catch (error: any) {
    return json({ error: errMsg(error) }, 400)
  }
})
