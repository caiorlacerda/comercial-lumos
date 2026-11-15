// Migração das pastas do Drive de projetos ANTIGOS (v1) para a estrutura nova (v2), de UM cliente por vez.
// Roda dentro do Supabase com o segredo GOOGLE_SERVICE_ACCOUNT_JSON que já existe (não precisa baixar chave nenhuma).
//
// Chamada (POST, JSON):  { cliente, modo?, projeto?, confirmar_cliente?, mover_para_mes?, renomear_assets?, entrega_vazia_para_lixeira? }
//   · modo = "simulacao" (PADRÃO): só LÊ o Drive e devolve o plano. O cliente do Drive é criado em modo somente leitura,
//     então a simulação não consegue escrever nem por engano, e o banco não é tocado.
//   · modo = "executar": move/cria/manda para a lixeira e grava o projeto como v2 no banco. Exige `confirmar_cliente`
//     igual ao nome do cliente (mesma trava do script: digitar o nome).
//   · cliente que não existe, ou parecido com mais de um, devolve 409 com as opções e não faz nada.
//
// Auth: header x-migracao-secret == secret DRIVE_MIGRACAO_SECRET (comparação em tempo constante). Sem o secret configurado
// ninguém entra. Deploy com --no-verify-jwt (a trava é o segredo; a chave anônima do front não abre esta função).
// Secrets usados: GOOGLE_SERVICE_ACCOUNT_JSON, DRIVE_SHARED_DRIVE_ID, DRIVE_MIGRACAO_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// A resposta nunca inclui a conta de serviço nem o segredo.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { criarDrive } from "./drive.mjs"
import { executarPlanos, filtrarProjetos, planejarCliente } from "./nucleo.mjs"

const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase()

/** Compara o segredo sem vazar nada pelo tempo: tira o SHA-256 dos dois e compara byte a byte. */
async function segredoConfere(recebido: string | null): Promise<boolean> {
  const esperado = Deno.env.get('DRIVE_MIGRACAO_SECRET') ?? ''
  if (!esperado || !recebido) return false
  const enc = new TextEncoder()
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(esperado)), crypto.subtle.digest('SHA-256', enc.encode(recebido))])
  const x = new Uint8Array(a), y = new Uint8Array(b)
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

/** Lê o secret da conta de serviço. O erro é genérico de propósito: o do JSON.parse pode citar um trecho do conteúdo. */
function contaDeServico() {
  try { return JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') ?? '{}') } catch (_) { throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON inválido') }
}

async function log(entityId: string | null, action: string, detail: string, status: 'ok' | 'error' = 'ok') {
  try { await db.from('drive_sync_log').insert([{ entity_type: 'project', entity_id: entityId, action, detail: detail.slice(0, 900), status }]) } catch (_) { /* log nunca derruba o fluxo */ }
}

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'método não permitido' }, 405)
  if (!(await segredoConfere(req.headers.get('x-migracao-secret')))) return json({ error: 'unauthorized' }, 401)

  let b: any
  try { b = await req.json() } catch (_) { return json({ error: 'JSON inválido' }, 400) }
  const nomeCliente = String(b?.cliente ?? '').trim()
  const modo = b?.modo ?? 'simulacao'
  if (!nomeCliente) return json({ error: 'cliente é obrigatório' }, 400)
  if (modo !== 'simulacao' && modo !== 'executar') return json({ error: 'modo deve ser "simulacao" ou "executar"' }, 400)
  const executar = modo === 'executar'
  if (executar && norm(b?.confirmar_cliente) !== norm(nomeCliente)) {
    return json({ error: 'para executar, envie confirmar_cliente igual ao nome do cliente; nada foi feito' }, 400)
  }

  try {
    // 1) Cliente: tem que ser UM só. Parecido com vários (ou nenhum igual) → devolve as opções e para.
    const curinga = nomeCliente.replace(/[\\%_]/g, '\\$&')
    const { data: candidatos, error: erroCli } = await db.from('clients').select('id, name, drive_folder_id, marcas').ilike('name', `%${curinga}%`).limit(25)
    if (erroCli) throw new Error(`banco (clients): ${erroCli.message}`)
    const iguais = (candidatos ?? []).filter((c: any) => norm(c.name) === norm(nomeCliente))
    if (iguais.length !== 1) {
      return json({
        error: iguais.length > 1 ? 'há mais de um cliente com esse nome' : (candidatos?.length ? 'nenhum cliente com esse nome exato; há parecidos' : 'cliente não encontrado'),
        opcoes: (candidatos ?? []).map((c: any) => ({ id: c.id, nome: c.name })),
      }, 409)
    }
    const cliente = iguais[0]

    // 2) Projetos do cliente, no mesmo formato da consulta B do script.
    const { data: linhas, error: erroPrj } = await db.from('projects').select('*, budget:budgets(category)').eq('client_id', cliente.id)
    if (erroPrj) throw new Error(`banco (projects): ${erroPrj.message}`)
    const projetos = (linhas ?? []).map((p: any) => ({
      id: p.id, code: p.code, name: p.name, status: p.status,
      category: p.category ?? p.budget?.category ?? 'digital',
      layout: p.drive_layout ?? 'v1', marca: p.marca ?? null,
      data_inicio: p.data_inicio ?? null, created_at: p.created_at,
      drive_folder_id: p.drive_folder_id, drive_upload_folder_id: p.drive_upload_folder_id,
      client_id: cliente.id, client_name: cliente.name, client_drive_folder_id: cliente.drive_folder_id,
      client_marcas: cliente.marcas ?? [],
    }))
    const alvos = filtrarProjetos(projetos, cliente.name, b?.projeto ? String(b.projeto) : undefined)
    if (!alvos.length) return json({ error: `nenhum projeto encontrado para "${cliente.name}"${b?.projeto ? ` e projeto "${b.projeto}"` : ''}` }, 404)

    // 3) Plano (só leitura). A simulação usa um Drive que recusa qualquer escrita.
    const drive = criarDrive({
      sa: contaDeServico(),
      driveId: Deno.env.get('DRIVE_SHARED_DRIVE_ID') ?? '',
      somenteLeitura: !executar,
    })
    const opcoes = {
      moverParaMes: b?.mover_para_mes === true,
      renomearAssets: b?.renomear_assets === true,
      entregaVaziaParaLixeira: b?.entrega_vazia_para_lixeira === true,
    }
    const plano = await planejarCliente({ drive, cliente: cliente.name, projetos: alvos, opcoes })
    const base = {
      ok: true, modo, cliente: { id: cliente.id, nome: cliente.name }, opcoes, resumo: plano.resumo,
      pulados: plano.pulados, relatorio: plano.texto,
      projetos: plano.itens.map(({ p, plano: pl }: any) => ({ id: p.id, code: p.code, nome: p.name, passos: pl.passos, ignorados: pl.ignorados, avisos: pl.avisos, sobraEmEntrega: pl.sobraEmEntrega })),
    }
    if (!executar) return json({ ...base, alterou: false })

    // 4) Executar: aplica o plano recém-montado e grava cada projeto como v2 logo depois do Drive.
    const resultado = await executarPlanos({
      drive, plano, opcoes,
      aoMigrar: async (p: any, pastas: Record<string, string>) => {
        const { data, error } = await db.from('projects')
          .update({ drive_layout: 'v2', drive_upload_folder_id: pastas.revisao, drive_pastas: pastas })
          .eq('id', p.id).eq('drive_layout', 'v1').select('id')
        if (error) throw new Error(`banco (projects): ${error.message}`)
        if (!data?.length) throw new Error('banco: nenhum projeto atualizado (já era v2?)')
        await log(p.id, 'migracao_v2', `migrado para v2 pela drive-migracao; revisão ${pastas.revisao}`)
      },
    })
    if (resultado.erro) await log(null, 'migracao_v2', `FALHOU em ${resultado.erro}`, 'error')
    return json({ ...base, alterou: true, resultado }, resultado.erro ? 500 : 200)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await log(null, 'migracao_v2', `erro: ${msg}`, 'error')
    return json({ ok: false, error: msg }, 500)
  }
})
