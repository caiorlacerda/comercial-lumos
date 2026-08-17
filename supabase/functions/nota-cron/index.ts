// nota-cron — cobrança automática de nota fiscal dos fornecedores.
//
// Chamada de dois jeitos:
//  · pg_cron diário (body vazio): envia o e-mail de toda cobrança 'agendada'
//    cujo enviar_em já chegou (serviço + 28 dias).
//  · Pelo app (body { id }): botão "Enviar agora" numa cobrança específica,
//    só pra usuário logado.
//
// Precisa do secret RESEND_API_KEY (Edge Functions → Secrets no dashboard).

import { createClient } from 'jsr:@supabase/supabase-js@2';

const APP_URL = 'https://app.produtoralumos.com.br';
const FROM = 'Produtora Lumos <nao-responda@mail.produtoralumos.com.br>';
const LOGO_URL = `${APP_URL}/logo-lumos.png`;
// Dados de faturamento da Lumos (o tomador da nota).
const LUMOS_CNPJ = '51.253.010/0001-70';
const LUMOS_RAZAO = 'LUMOS PRODUTORA AUDIOVISUAL LTDA';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const brl = (v: number | null) =>
  v == null ? '' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const brData = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

function emailHtml(r: {
  fornecedor: string; descricao: string; projeto: string | null;
  valor: number | null; pagar_em: string; link: string;
}) {
  const valorTxt = r.valor != null ? ` no valor de <strong>${brl(r.valor)}</strong>` : '';
  const linhaDado = (rotulo: string, valor: string) => `
        <tr>
          <td style="padding: 5px 0; font-size: 12px; color: #777; white-space: nowrap; vertical-align: top;">${rotulo}</td>
          <td style="padding: 5px 0 5px 16px; font-size: 13px; color: #1a1a1a; font-weight: bold;">${valor}</td>
        </tr>`;
  return `
  <div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
    <div style="background: #ffffff; padding: 22px 28px 18px; border: 1px solid #e5e5e5; border-bottom: 4px solid #EFC700; border-radius: 12px 12px 0 0;">
      <img src="${LOGO_URL}" alt="Lumos" height="30" style="display: block; height: 30px;" />
    </div>
    <div style="border: 1px solid #e5e5e5; border-top: 0; border-radius: 0 0 12px 12px; padding: 28px; background: #ffffff;">
      <p style="font-size: 15px;">Olá, <strong>${r.fornecedor}</strong>!</p>
      <p style="font-size: 14px; line-height: 1.6;">
        O pagamento do seu job <strong>${r.descricao}</strong>${r.projeto ? ` (projeto ${r.projeto})` : ''}${valorTxt}
        está previsto para <strong>${brData(r.pagar_em)}</strong>.
      </p>
      <p style="font-size: 14px; line-height: 1.6;">
        Para recebermos tudo em dia, precisamos que você emita sua nota fiscal. Os dados para a emissão:
      </p>
      <div style="background: #faf8f0; border: 1px solid #EFC700; border-radius: 10px; padding: 16px 20px; margin: 18px 0;">
        <table cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
          ${linhaDado('CNPJ', LUMOS_CNPJ)}
          ${linhaDado('Razão Social', LUMOS_RAZAO)}
          ${linhaDado('Descrição na nota', `Serviços prestados de ${r.descricao}`)}
          ${r.valor != null ? linhaDado('Valor', brl(r.valor)) : ''}
        </table>
      </div>
      <p style="font-size: 14px; line-height: 1.6;">
        Depois é só enviar o arquivo pelo botão abaixo. Na mesma página, confirme também os seus
        <strong>dados bancários e a sua chave PIX</strong>, para o pagamento cair certinho:
      </p>
      <p style="text-align: center; margin: 26px 0;">
        <a href="${r.link}" style="background: #EFC700; color: #111; font-weight: 800; font-size: 14px; text-decoration: none; padding: 13px 30px; border-radius: 8px; display: inline-block;">
          Enviar nota fiscal
        </a>
      </p>
      <p style="font-size: 12px; color: #777; line-height: 1.6;">
        Se o botão não abrir, copie este endereço no navegador:<br/>
        <a href="${r.link}" style="color: #555;">${r.link}</a>
      </p>
      <p style="font-size: 12px; color: #777;">Qualquer dúvida, é só falar com a produção da Lumos. Obrigado!</p>
    </div>
  </div>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) {
    return new Response(JSON.stringify({ ok: false, error: 'RESEND_API_KEY não configurada' }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  let body: { id?: string } = {};
  try { body = await req.json(); } catch { /* cron manda body vazio */ }

  // "Enviar agora" exige usuário logado (o cron usa a anon key e não manda id).
  if (body.id) {
    try {
      const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
      const payload = JSON.parse(atob(jwt.split('.')[1]));
      if (payload.role !== 'authenticated') throw new Error('não autenticado');
    } catch {
      return new Response(JSON.stringify({ ok: false, error: 'só usuário logado pode enviar agora' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
  }

  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

  let query = admin
    .from('nota_requests')
    .select('id, descricao, valor, pagar_em, token, cost_id, fornecedor:fornecedores(nome, email), projeto:projects(name)')
    .eq('status', 'agendada');
  query = body.id ? query.eq('id', body.id) : query.lte('enviar_em', hoje);

  const { data: pendentes, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const resultados: { id: string; ok: boolean; motivo?: string }[] = [];

  for (const r of pendentes || []) {
    const forn = r.fornecedor as unknown as { nome: string; email: string | null };
    const proj = r.projeto as unknown as { name: string } | null;

    // Custo já pago antes da cobrança sair? Cancela em vez de cobrar.
    if (r.cost_id) {
      const { data: custo } = await admin.from('project_costs').select('status').eq('id', r.cost_id).maybeSingle();
      if (custo?.status === 'pago') {
        await admin.from('nota_requests').update({ status: 'cancelada', updated_at: new Date().toISOString() }).eq('id', r.id);
        resultados.push({ id: r.id, ok: false, motivo: 'custo já pago, cobrança cancelada' });
        continue;
      }
    }

    if (!forn?.email) {
      resultados.push({ id: r.id, ok: false, motivo: 'fornecedor sem e-mail' });
      continue;
    }

    const link = `${APP_URL}/nota/${r.token}`;
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: FROM,
        to: [forn.email],
        subject: `Nota fiscal do job ${r.descricao}`,
        html: emailHtml({
          fornecedor: forn.nome,
          descricao: r.descricao,
          projeto: proj?.name || null,
          valor: r.valor,
          pagar_em: r.pagar_em,
          link,
        }),
      }),
    });

    if (resp.ok) {
      await admin.from('nota_requests').update({
        status: 'email_enviado',
        email_enviado_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', r.id);
      resultados.push({ id: r.id, ok: true });
    } else {
      const erro = await resp.text();
      console.error(`Resend falhou pra cobrança ${r.id}:`, erro);
      resultados.push({ id: r.id, ok: false, motivo: `resend: ${erro.slice(0, 200)}` });
    }
  }

  return new Response(JSON.stringify({ ok: true, processadas: resultados.length, resultados }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
});
