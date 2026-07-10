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

// Extrai mensagem legível de qualquer formato de erro (Error serializa vazio).
function errMsg(e: any): string {
  if (!e) return 'Erro desconhecido'
  if (typeof e === 'string') return e
  return (
    e.message || e.error_description || e.error || e.msg || e.hint || e.details ||
    JSON.stringify(e, Object.getOwnPropertyNames(e))
  )
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

    // 1. Autoriza: só um admin ativo pode excluir usuários.
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
      return json({ error: 'Apenas administradores podem excluir usuários.' }, 403)
    }

    // 2. Valida os ids (de app_users).
    const { ids } = await req.json()
    if (!Array.isArray(ids) || ids.length === 0) {
      return json({ error: 'Nenhum usuário informado.' }, 400)
    }

    // 3. Nunca exclui a própria conta (evita lockout).
    const targetIds = ids.filter((id: string) => id !== callerProfile.id)
    if (targetIds.length === 0) {
      return json({ error: 'Você não pode excluir a sua própria conta.' }, 400)
    }

    // 4. Resolve os auth_user_id correspondentes.
    const { data: rows, error: rowsErr } = await adminClient
      .from('app_users')
      .select('id, auth_user_id')
      .in('id', targetIds)
    if (rowsErr) return json({ error: errMsg(rowsErr) }, 400)

    // 5. Apaga cada conta de auth (não bloqueia se uma já não existir — cobre
    //    também a limpeza de contas órfãs de exclusões antigas).
    const warnings: string[] = []
    for (const row of rows ?? []) {
      if (row.auth_user_id) {
        const { error: delErr } = await adminClient.auth.admin.deleteUser(row.auth_user_id)
        if (delErr) warnings.push(`${row.id}: ${errMsg(delErr)}`)
      }
    }

    // 6. Apaga os perfis em app_users (no-op se o cascade já removeu).
    const { error: profileDelErr } = await adminClient
      .from('app_users')
      .delete()
      .in('id', targetIds)
    if (profileDelErr) return json({ error: errMsg(profileDelErr) }, 400)

    return json({ message: 'Usuários excluídos', deleted: targetIds.length, warnings }, 200)
  } catch (error: any) {
    return json({ error: errMsg(error) }, 400)
  }
})
