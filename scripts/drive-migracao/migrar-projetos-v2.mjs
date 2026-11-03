#!/usr/bin/env node
// Migra projetos ANTIGOS (layout v1) do Drive para a estrutura nova (v2), de UM cliente por vez.
//
//   SIMULAÇÃO (padrão: não altera nada, só lê o Drive e mostra o plano):
//     node scripts/drive-migracao/migrar-projetos-v2.mjs --projetos projetos.json --sa conta-de-servico.json \
//          --drive-id <ID do Drive compartilhado> --cliente "Nome do cliente"
//
//   EXECUTAR (só com o OK do Caio; pede para digitar o nome do cliente):
//     ... --cliente "Nome do cliente" --executar [--projeto <id ou código>] [--mover-para-mes]
//
// Só MOVE pastas (o ID não muda). Não copia, não apaga e só renomeia 02_APROVADO → 02_FINAL.
// Não escreve no banco: gera um arquivo .sql para o Caio rodar no SQL Editor logo depois.
// Lives e projetos que já são v2 são pulados.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { NOMES, mesDoProjeto, planejarProjeto, sqlDeAtualizacao } from './plano.mjs';

// ---------- argumentos ----------
const args = process.argv.slice(2);
const flag = n => args.includes(`--${n}`);
const val = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };

const ARQ_PROJETOS = val('projetos');
const ARQ_SA = val('sa') || process.env.GOOGLE_SERVICE_ACCOUNT_JSON_FILE;
const DRIVE_ID = val('drive-id') || process.env.DRIVE_SHARED_DRIVE_ID;
const CLIENTE = val('cliente');
const SO_PROJETO = val('projeto');
const EXECUTAR = flag('executar');
const MOVER_PARA_MES = flag('mover-para-mes');
const SAIDA = val('saida') || path.join(process.cwd(), 'saida-drive');

function parar(msg) { console.error(`\nERRO: ${msg}\n`); process.exit(1); }
if (!ARQ_PROJETOS || !ARQ_SA || !DRIVE_ID || !CLIENTE) {
  parar('faltam argumentos. Obrigatórios: --projetos <arquivo.json> --sa <conta-de-servico.json> --drive-id <id> --cliente "<nome>"');
}

// ---------- Google Drive (conta de serviço, sem dependências) ----------
// Os dois endereços só mudam nos testes automáticos (Drive falso em memória); em uso real são os do Google.
const DRIVE_API = process.env.DRIVE_API_BASE || 'https://www.googleapis.com/drive/v3';
const TOKEN_URL = process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const sa = JSON.parse(fs.readFileSync(ARQ_SA, 'utf8'));
let tokenCache = null;
const b64u = b => Buffer.from(b).toString('base64url');

async function token() {
  const agora = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp > agora + 60) return tokenCache.token;
  const cab = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const corpo = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/drive', aud: 'https://oauth2.googleapis.com/token', iat: agora, exp: agora + 3600 }));
  const assinatura = crypto.createSign('RSA-SHA256').update(`${cab}.${corpo}`).sign(sa.private_key).toString('base64url');
  const r = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${cab}.${corpo}.${assinatura}`,
  });
  const j = await r.json();
  if (!j.access_token) parar(`não consegui o token do Google: ${JSON.stringify(j).slice(0, 200)}`);
  tokenCache = { token: j.access_token, exp: agora + 3500 };
  return tokenCache.token;
}

async function api(caminho, init = {}, tentativa = 1) {
  const sep = caminho.includes('?') ? '&' : '?';
  const r = await fetch(`${DRIVE_API}/${caminho}${sep}supportsAllDrives=true`, {
    ...init, headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if ((r.status === 429 || r.status >= 500) && tentativa <= 4) { await new Promise(x => setTimeout(x, tentativa * 1200)); return api(caminho, init, tentativa + 1); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Drive ${r.status} em ${caminho.split('?')[0]}: ${JSON.stringify(j.error?.message || j).slice(0, 220)}`);
  return j;
}

const FOLDER = 'application/vnd.google-apps.folder';

async function listar(paiId) {
  const itens = []; let pagina = '';
  do {
    const q = encodeURIComponent(`'${paiId}' in parents and trashed=false`);
    const j = await api(`files?q=${q}&fields=files(id,name,mimeType),nextPageToken&pageSize=200&includeItemsFromAllDrives=true&corpora=drive&driveId=${DRIVE_ID}${pagina ? `&pageToken=${pagina}` : ''}`);
    itens.push(...(j.files || []).map(f => ({ id: f.id, name: f.name, isFolder: f.mimeType === FOLDER })));
    pagina = j.nextPageToken || '';
  } while (pagina);
  return itens;
}

const criarPasta = async (paiId, nome) => (await api('files?fields=id', { method: 'POST', body: JSON.stringify({ name: nome, mimeType: FOLDER, parents: [paiId] }) })).id;

/** Move (e, se pedido, renomeia). O ID do item NÃO muda. */
async function mover(id, novoPaiId, novoNome) {
  const atual = await api(`files/${id}?fields=parents,name`);
  const paisAntigos = (atual.parents || []).join(',');
  await api(`files/${id}?addParents=${novoPaiId}${paisAntigos ? `&removeParents=${paisAntigos}` : ''}&fields=id`, {
    method: 'PATCH', body: JSON.stringify(novoNome ? { name: novoNome } : {}),
  });
  return { paisAntigos: atual.parents || [], nomeAntigo: atual.name };
}

// ---------- seleção dos projetos ----------
const todos = JSON.parse(fs.readFileSync(ARQ_PROJETOS, 'utf8'));
const norm = s => String(s ?? '').trim().toLowerCase();
let alvos = todos.filter(p => norm(p.client_name) === norm(CLIENTE));
if (SO_PROJETO) alvos = alvos.filter(p => p.id === SO_PROJETO || norm(p.code) === norm(SO_PROJETO));
if (!alvos.length) parar(`nenhum projeto encontrado para o cliente "${CLIENTE}"${SO_PROJETO ? ` e projeto "${SO_PROJETO}"` : ''} em ${ARQ_PROJETOS}`);

const pular = p =>
  p.layout === 'v2' ? 'já é v2'
    : (p.category || '').toLowerCase() === 'live' ? 'live: segue no template de live (v1)'
      : !p.drive_folder_id ? 'sem pasta no Drive'
        : null;

// ---------- plano ----------
async function montarPlano(p) {
  const filhos = await listar(p.drive_folder_id);
  const entrega = filhos.find(f => f.isFolder && f.name === '06_ENTREGA') ?? null;
  const filhosEntrega = entrega ? await listar(entrega.id) : null;
  const filhosDosAlvos = {};
  for (const chave of ['documentos', 'bruto', 'artes', 'export']) {
    const j = filhos.find(f => f.isFolder && f.name === NOMES[chave]);
    if (j) filhosDosAlvos[chave] = await listar(j.id);
  }
  return { ...planejarProjeto({ filhos, filhosEntrega, filhosDosAlvos }), entregaId: entrega?.id ?? null };
}

function descrever(p, plano) {
  const L = [];
  L.push(`### ${p.code ?? ''} ${p.name}  (${p.status}, id ${p.id})`);
  for (const s of plano.passos) {
    if (s.op === 'reusar') L.push(`- REAPROVEITA  ${s.nome}  [${s.id}]  → vira ${NOMES[s.chave]}`);
    if (s.op === 'criar') L.push(`- CRIA         ${s.nome}  dentro de ${s.pai === 'raiz' ? 'a pasta do projeto' : NOMES[s.pai]}`);
    if (s.op === 'mover') L.push(`- MOVE         ${s.nome}  [${s.id}]  de ${s.de === '06_ENTREGA' ? '06_ENTREGA' : 'a pasta do projeto'} → ${NOMES[s.para]}${s.renomearPara ? `   (renomeia para ${s.renomearPara})` : ''}`);
    if (s.op === 'conflito') L.push(`- CONFLITO     ${s.nome}  [${s.id}]  ${s.motivo}: NÃO será movida`);
  }
  for (const i of plano.ignorados) L.push(`- fica         ${i.nome}  (${i.motivo})`);
  if (plano.sobraEmEntrega.length) L.push(`- 06_ENTREGA continua com: ${plano.sobraEmEntrega.map(x => x.nome).join(', ')}`);
  else if (plano.entregaId) L.push('- 06_ENTREGA ficará VAZIA (não será apagada nem renomeada; você decide depois)');
  for (const a of plano.avisos) L.push(`- ATENÇÃO      ${a}`);
  return L;
}

// ---------- execução ----------
async function aplicar(p, plano) {
  const ctx = { raiz: p.drive_folder_id };
  const feito = [];
  for (const s of plano.passos) {
    if (s.op === 'reusar') { ctx[s.chave] = s.id; }
    else if (s.op === 'criar') { ctx[s.chave] = await criarPasta(ctx[s.pai === 'raiz' ? 'raiz' : s.pai], s.nome); feito.push({ op: 'criada', id: ctx[s.chave], nome: s.nome }); }
    else if (s.op === 'mover') {
      const r = await mover(s.id, ctx[s.para], s.renomearPara);
      if (s.registra) ctx[s.registra] = s.id;
      feito.push({ op: 'movida', id: s.id, nomeAntigo: r.nomeAntigo, nomeNovo: s.renomearPara ?? r.nomeAntigo, paisAntigos: r.paisAntigos, paiNovo: ctx[s.para] });
    }
  }
  return { ctx, feito };
}

async function moverParaMes(p, plano, executar) {
  const mes = mesDoProjeto(p.data_inicio, p.created_at);
  if ((p.client_marcas || []).length) return { aviso: `cliente tem marcas e o projeto não tem marca: não movo para ${mes} (decida a marca antes)` };
  if (!p.client_drive_folder_id) return { aviso: 'cliente sem pasta registrada: não movo para a pasta do mês' };
  if (!executar) return { texto: `- MOVE         a pasta do projeto → ${p.client_name}/${mes}/  (opção --mover-para-mes)` };
  const existentes = (await listar(p.client_drive_folder_id)).filter(f => f.isFolder && f.name === mes);
  const mesId = existentes.length ? existentes[0].id : await criarPasta(p.client_drive_folder_id, mes);
  const r = await mover(p.drive_folder_id, mesId);
  return { feito: { op: 'movida', id: p.drive_folder_id, nomeAntigo: r.nomeAntigo, nomeNovo: r.nomeAntigo, paisAntigos: r.paisAntigos, paiNovo: mesId } };
}

// ---------- principal ----------
const carimbo = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const slug = norm(CLIENTE).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
fs.mkdirSync(SAIDA, { recursive: true });

const relatorio = [`# ${EXECUTAR ? 'EXECUÇÃO' : 'SIMULAÇÃO (nada foi alterado)'} — ${CLIENTE} — ${new Date().toLocaleString('pt-BR')}`, ''];
const planos = [];
for (const p of alvos) {
  const motivo = pular(p);
  if (motivo) { relatorio.push(`### ${p.code ?? ''} ${p.name}  → pulado: ${motivo}`, ''); continue; }
  const plano = await montarPlano(p);
  const linhas = descrever(p, plano);
  if (MOVER_PARA_MES) {
    const m = await moverParaMes(p, plano, false);
    if (m.texto) linhas.push(m.texto);
    if (m.aviso) linhas.push(`- ATENÇÃO      ${m.aviso}`);
  }
  relatorio.push(...linhas, '');
  planos.push({ p, plano });
}

const resumo = planos.reduce((a, { plano }) => {
  for (const s of plano.passos) a[s.op] = (a[s.op] || 0) + 1;
  return a;
}, {});
relatorio.push(`## Resumo: ${planos.length} projeto(s) a migrar — ${resumo.criar ?? 0} criação(ões), ${resumo.mover ?? 0} movimento(s), ${resumo.reusar ?? 0} reaproveitamento(s), ${resumo.conflito ?? 0} conflito(s)`);
const textoPlano = relatorio.join('\n');
console.log('\n' + textoPlano + '\n');
const arqPlano = path.join(SAIDA, `plano-${slug}-${carimbo}.md`);
fs.writeFileSync(arqPlano, textoPlano);
console.log(`Plano salvo em ${arqPlano}`);

if (!EXECUTAR) {
  console.log('\nSIMULAÇÃO: nada foi alterado. Para executar (só com o OK do Caio): repita o comando com --executar.');
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const resp = await rl.question(`\nIsto vai MOVER pastas no Drive de ${planos.length} projeto(s) de "${CLIENTE}". Digite o nome do cliente para confirmar: `);
rl.close();
if (norm(resp) !== norm(CLIENTE)) parar('nome diferente: nada foi executado.');

const logFeito = []; const sqls = []; const vazias = [];
for (const { p, plano } of planos) {
  process.stdout.write(`\n${p.code ?? ''} ${p.name}: `);
  try {
    const { ctx, feito } = await aplicar(p, plano);
    const pastas = Object.fromEntries(Object.keys(NOMES).map(k => [k, ctx[k]]));
    sqls.push(`-- ${p.code ?? ''} ${p.name}\n${sqlDeAtualizacao(p.id, pastas)}`);
    if (MOVER_PARA_MES) { const m = await moverParaMes(p, plano, true); if (m.feito) feito.push(m.feito); if (m.aviso) console.log(`(${m.aviso})`); }
    if (plano.entregaId && (await listar(plano.entregaId)).length === 0) vazias.push(`${p.code ?? ''} ${p.name} → 06_ENTREGA [${plano.entregaId}]`);
    logFeito.push({ projeto: p.id, nome: p.name, feito });
    console.log('ok');
  } catch (e) {
    console.log(`FALHOU: ${e.message}\n   Pare aqui e me mostre o erro. O que já foi feito neste projeto está em ${SAIDA}/feito-*.json.`);
    logFeito.push({ projeto: p.id, nome: p.name, erro: e.message });
    break;
  }
}

fs.writeFileSync(path.join(SAIDA, `feito-${slug}-${carimbo}.json`), JSON.stringify(logFeito, null, 2));
const arqSql = path.join(SAIDA, `atualizar-banco-${slug}-${carimbo}.sql`);
fs.writeFileSync(arqSql, `-- Rode no SQL Editor logo depois da migração. Atualiza só os projetos migrados.\n\n${sqls.join('\n\n')}\n`);
console.log(`\nSQL para rodar agora no banco: ${arqSql}`);
if (vazias.length) console.log(`\nPastas antigas que ficaram VAZIAS (você decide o que fazer):\n  - ${vazias.join('\n  - ')}`);
