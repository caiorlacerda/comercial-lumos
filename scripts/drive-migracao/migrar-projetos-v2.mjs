#!/usr/bin/env node
// Migra projetos ANTIGOS (layout v1) do Drive para a estrutura nova (v2), de UM cliente por vez, a partir do computador.
//
// ATENÇÃO: o caminho normal é a edge function `drive-migracao` (roda dentro do Supabase, sem precisar baixar a chave
// da conta de serviço). Este script faz a MESMA coisa (mesmo núcleo em supabase/functions/drive-migracao) e só serve
// se alguém tiver o JSON da conta de serviço em mãos.
//
//   SIMULAÇÃO (padrão: não altera nada, só lê o Drive e mostra o plano):
//     node scripts/drive-migracao/migrar-projetos-v2.mjs --projetos projetos.json --sa conta-de-servico.json \
//          --drive-id <ID do Drive compartilhado> --cliente "Nome do cliente"
//
//   EXECUTAR (só com o OK do Caio; pede para digitar o nome do cliente):
//     ... --cliente "Nome do cliente" --executar [--projeto <id ou código>] [--mover-para-mes] [--renomear-assets] [--entrega-vazia-para-lixeira]
//
// Só move pastas/arquivos (o ID não muda). Não copia e nunca exclui de vez: o que sobra vazio vai para a LIXEIRA, e só
// se estiver vazio na hora. Não escreve no banco: gera um arquivo .sql para o Caio rodar no SQL Editor logo depois.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { criarDrive } from '../../supabase/functions/drive-migracao/drive.mjs';
import { executarPlanos, filtrarProjetos, planejarCliente } from '../../supabase/functions/drive-migracao/nucleo.mjs';
import { sqlDeAtualizacao } from '../../supabase/functions/drive-migracao/plano.mjs';

const args = process.argv.slice(2);
const flag = n => args.includes(`--${n}`);
const val = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };

const ARQ_PROJETOS = val('projetos');
const ARQ_SA = val('sa') || process.env.GOOGLE_SERVICE_ACCOUNT_JSON_FILE;
const DRIVE_ID = val('drive-id') || process.env.DRIVE_SHARED_DRIVE_ID;
const CLIENTE = val('cliente');
const SO_PROJETO = val('projeto');
const EXECUTAR = flag('executar');
const OPCOES = { moverParaMes: flag('mover-para-mes'), renomearAssets: flag('renomear-assets'), entregaVaziaParaLixeira: flag('entrega-vazia-para-lixeira') };
const SAIDA = val('saida') || path.join(process.cwd(), 'saida-drive');

function parar(msg) { console.error(`\nERRO: ${msg}\n`); process.exit(1); }
if (!ARQ_PROJETOS || !ARQ_SA || !DRIVE_ID || !CLIENTE) {
  parar('faltam argumentos. Obrigatórios: --projetos <arquivo.json> --sa <conta-de-servico.json> --drive-id <id> --cliente "<nome>"');
}

// Os dois endereços só mudam nos testes automáticos (Drive falso em memória); em uso real são os do Google.
const drive = criarDrive({
  sa: JSON.parse(fs.readFileSync(ARQ_SA, 'utf8')),
  driveId: DRIVE_ID,
  somenteLeitura: !EXECUTAR,
  apiBase: process.env.DRIVE_API_BASE || undefined,
  tokenUrl: process.env.GOOGLE_TOKEN_URL || undefined,
});

const norm = s => String(s ?? '').trim().toLowerCase();
const alvos = filtrarProjetos(JSON.parse(fs.readFileSync(ARQ_PROJETOS, 'utf8')), CLIENTE, SO_PROJETO);
if (!alvos.length) parar(`nenhum projeto encontrado para o cliente "${CLIENTE}"${SO_PROJETO ? ` e projeto "${SO_PROJETO}"` : ''} em ${ARQ_PROJETOS}`);

const carimbo = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const slug = norm(CLIENTE).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
fs.mkdirSync(SAIDA, { recursive: true });

const plano = await planejarCliente({ drive, cliente: CLIENTE, projetos: alvos, opcoes: OPCOES });
const textoPlano = `# ${EXECUTAR ? 'EXECUÇÃO' : 'SIMULAÇÃO (nada foi alterado)'} — ${CLIENTE} — ${new Date().toLocaleString('pt-BR')}\n\n${plano.texto}`;
console.log('\n' + textoPlano + '\n');
const arqPlano = path.join(SAIDA, `plano-${slug}-${carimbo}.md`);
fs.writeFileSync(arqPlano, textoPlano);
console.log(`Plano salvo em ${arqPlano}`);

if (!EXECUTAR) {
  console.log('\nSIMULAÇÃO: nada foi alterado. Para executar (só com o OK do Caio): repita o comando com --executar.');
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const resp = await rl.question(`\nIsto vai MOVER pastas no Drive de ${plano.itens.length} projeto(s) de "${CLIENTE}"${plano.planoMarca?.acao === 'renomear' ? ' e RENOMEAR a _ASSETS para MARCA' : ''}. Digite o nome do cliente para confirmar: `);
rl.close();
if (norm(resp) !== norm(CLIENTE)) parar('nome diferente: nada foi executado.');

const sqls = [];
const res = await executarPlanos({
  drive, plano, opcoes: OPCOES,
  aoMigrar: (p, pastas) => { sqls.push(`-- ${p.code ?? ''} ${p.name}\n${sqlDeAtualizacao(p.id, pastas)}`); },
});

for (const r of res.projetos) console.log(`\n${r.code ?? ''} ${r.nome}: ${r.erro ? `FALHOU: ${r.erro}\n   Pare aqui e me mostre o erro. O que já foi feito neste projeto está em ${SAIDA}/feito-*.json.` : 'ok'}`);
if (res.renomeouMarca) console.log(`\nPasta de materiais fixos: _ASSETS → MARCA (ok, mesmo ID ${res.renomeouMarca.id})`);
if (res.naoProcessados.length) console.log(`\nNão processados (tempo): ${res.naoProcessados.map(x => `${x.code ?? ''} ${x.nome}`).join(', ')}`);
for (const a of res.avisos) console.log(`ATENÇÃO: ${a}`);

fs.writeFileSync(path.join(SAIDA, `feito-${slug}-${carimbo}.json`), JSON.stringify(res, null, 2));
const arqSql = path.join(SAIDA, `atualizar-banco-${slug}-${carimbo}.sql`);
fs.writeFileSync(arqSql, `-- Rode no SQL Editor logo depois da migração. Atualiza só os projetos migrados.\n\n${sqls.join('\n\n')}\n`);
console.log(`\nSQL para rodar agora no banco: ${arqSql}`);
if (res.vazias.length) console.log(`\nPastas antigas que ficaram VAZIAS (você decide o que fazer):\n  - ${res.vazias.join('\n  - ')}`);
if (res.erro) process.exit(1);
