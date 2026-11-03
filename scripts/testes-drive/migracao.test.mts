// Testa a edge function drive-migracao (o index.ts de verdade) com Supabase e Drive falsos.
// Rodar:  node --experimental-strip-types scripts/testes-drive/migracao.test.mts
import { register } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.join(aqui, 'hooks.mjs')).href);
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const CHAVE_PRIVADA = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const SEGREDO = 'segredo-de-teste-9f8e7d6c5b4a';
const env: Record<string, string> = {
  SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'service-role-de-teste', DRIVE_SHARED_DRIVE_ID: 'drive', DRIVE_MIGRACAO_SECRET: SEGREDO,
  GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'sa-teste@x.iam', private_key: CHAVE_PRIVADA }),
};
(globalThis as any).Deno = { env: { get: (k: string) => env[k] } };

// ---------- Drive falso ----------
const FOLDER = 'application/vnd.google-apps.folder';
let drive: Map<string, any>; const chamadas: string[] = [];
const filhos = (id: string) => [...drive.values()].filter(x => x.parents.includes(id) && !x.trashed);
const add = (id: string, name: string, pai: string | null, pasta = true) => { drive.set(id, { id, name, parents: pai ? [pai] : [], mimeType: pasta ? FOLDER : 'video/mp4', trashed: false }); };
(globalThis as any).fetch = async (url: string, init: any = {}) => {
  const u = new URL(url); const resp = (o: any, st = 200) => new Response(JSON.stringify(o), { status: st });
  if (u.hostname === 'oauth2.googleapis.com') return resp({ access_token: 't' });
  const m = (init.method || 'GET').toUpperCase(); const rota = u.pathname.replace('/drive/v3/', ''); const corpo = init.body ? JSON.parse(init.body) : {};
  chamadas.push(`${m} ${rota}`);
  if (m === 'GET' && rota === 'files') {
    const pai = /'([^']+)' in parents/.exec(u.searchParams.get('q')!)![1];
    return resp({ files: filhos(pai).map(x => ({ id: x.id, name: x.name, mimeType: x.mimeType })) });
  }
  const mm = /^files\/([^/]+)$/.exec(rota);
  if (mm && m === 'GET') { const x = drive.get(mm[1]); return x ? resp({ id: x.id, name: x.name, parents: x.parents }) : resp({ error: { message: 'nao existe' } }, 404); }
  if (mm && m === 'PATCH') {
    const x = drive.get(mm[1]); const add = u.searchParams.get('addParents'); const rem = (u.searchParams.get('removeParents') || '').split(',').filter(Boolean);
    if (add) x.parents = [...x.parents.filter((p: string) => !rem.includes(p)), add];
    if (corpo.name) x.name = corpo.name;
    if (corpo.trashed) x.trashed = true;
    return resp({ id: x.id });
  }
  if (m === 'POST' && rota === 'files') { const id = 'novo' + chamadas.length; add(id, corpo.name, corpo.parents[0], true); return resp({ id }); }
  return resp({ error: { message: 'rota ' + m + ' ' + rota } }, 400);
};
const escritas = () => chamadas.filter(c => !c.startsWith('GET '));

// ---------- banco falso ----------
const db: any = {}; (globalThis as any).__db = db;
const mod: any = await import(pathToFileURL(path.join(aqui, '../../supabase/functions/drive-migracao/index.ts')).href);
const handler = (globalThis as any).__handler;

function cenario() {
  drive = new Map(); chamadas.length = 0;
  add('drive', 'DRIVE', null); add('cli', 'Acme Filmes', 'drive');
  add('P1', '101_FILME', 'cli'); add('e1', '06_ENTREGA', 'P1'); add('rev1', '01_REVISAO', 'e1'); add('apr1', '02_APROVADO', 'e1'); add('rd1', '03_REDES', 'e1'); add('reels1', 'reels.mp4', 'rd1', false);
  add('P2', '102_LIVE', 'cli'); add('g2', '00_GERAL', 'P2');
  add('P9', '109_OUTRO', 'cli'); add('g9', '00_GERAL', 'P9');
  const base = { status: 'ativo', created_at: '2026-10-15T12:00:00Z', data_inicio: null, marca: null, drive_layout: 'v1', drive_upload_folder_id: null, drive_pastas: null };
  db.clients = [
    { id: 'c1', name: 'Acme Filmes', drive_folder_id: 'cli', marcas: [] },
    { id: 'c2', name: 'Acme Filmes Brasil', drive_folder_id: 'x2', marcas: [] },
    { id: 'c3', name: 'Beta', drive_folder_id: 'x3', marcas: [] }, { id: 'c4', name: 'Beta', drive_folder_id: 'x4', marcas: [] },
    { id: 'c5', name: '100%_Real', drive_folder_id: 'x5', marcas: [] },
  ];
  db.projects = [
    { ...base, id: 'u1', client_id: 'c1', code: '101', name: 'FILME', category: 'digital', drive_folder_id: 'P1' },
    { ...base, id: 'u2', client_id: 'c1', code: '102', name: 'LIVE', category: 'live', drive_folder_id: 'P2' },
    { ...base, id: 'u3', client_id: 'c1', code: '109', name: 'OUTRO', category: 'digital', drive_folder_id: 'P9', drive_layout: 'v2' },
  ];
  db.drive_sync_log = [];
}
const chama = (corpo: any, headers: Record<string, string> = { 'x-migracao-secret': SEGREDO }, metodo = 'POST') =>
  handler(new Request('http://x/', { method: metodo, headers: { 'Content-Type': 'application/json', ...headers }, body: metodo === 'GET' ? undefined : (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)) }));
const lerJson = async (r: Response) => ({ status: r.status, j: await r.json() });
const banco = () => JSON.stringify(db.projects);

let falhas = 0; const ok = (nome: string, c: any) => { console.log((c ? 'OK     ' : 'FALHA  ') + nome); if (!c) falhas++; };

// ---- 1) autenticação: nenhuma porta aberta
cenario();
let r = await chama({ cliente: 'Acme Filmes' }, {}, 'GET');
ok('GET → 405', r.status === 405);
for (const [nome, h] of [['sem o header', {}], ['segredo errado', { 'x-migracao-secret': 'errado' }], ['segredo vazio', { 'x-migracao-secret': '' }], ['só a chave anônima do front (Authorization)', { Authorization: 'Bearer eyJhbGciOi.anon.chave' }], ['segredo com sufixo', { 'x-migracao-secret': SEGREDO + 'x' }]] as const) {
  const { status } = await lerJson(await chama({ cliente: 'Acme Filmes', modo: 'executar', confirmar_cliente: 'Acme Filmes' }, h as any));
  ok(`${nome} → 401 e nada é feito`, status === 401 && chamadas.length === 0 && banco() === JSON.stringify(db.projects));
}
const semSecretNoServidor = env.DRIVE_MIGRACAO_SECRET; delete env.DRIVE_MIGRACAO_SECRET;
ok('secret não configurado no servidor: ninguém entra (nem com header vazio)', (await lerJson(await chama({ cliente: 'Acme Filmes' }, { 'x-migracao-secret': '' }))).status === 401 && (await lerJson(await chama({ cliente: 'Acme Filmes' }, { 'x-migracao-secret': 'qualquer' }))).status === 401);
env.DRIVE_MIGRACAO_SECRET = semSecretNoServidor;

// ---- 2) entrada inválida
ok('corpo que não é JSON → 400', (await lerJson(await chama('isto não é json'))).status === 400);
ok('sem cliente → 400', (await lerJson(await chama({ modo: 'simulacao' }))).status === 400);
ok('modo desconhecido → 400', (await lerJson(await chama({ cliente: 'Acme Filmes', modo: 'apagar' }))).status === 400);
cenario();
let x = await lerJson(await chama({ cliente: 'Acme Filmes', modo: 'executar' }));
ok('executar sem confirmar_cliente → 400 e nada é feito', x.status === 400 && chamadas.length === 0);
x = await lerJson(await chama({ cliente: 'Acme Filmes', modo: 'executar', confirmar_cliente: 'Outro Nome' }));
ok('executar com confirmação de OUTRO nome → 400 e nada é feito', x.status === 400 && chamadas.length === 0 && db.projects[0].drive_layout === 'v1');

// ---- 3) escolha do cliente: um só, nome exato
x = await lerJson(await chama({ cliente: 'Acme' }));
ok('nome parcial ("Acme") → 409 com as opções, sem tocar no Drive', x.status === 409 && x.j.opcoes.map((o: any) => o.nome).sort().join() === 'Acme Filmes,Acme Filmes Brasil' && chamadas.length === 0);
x = await lerJson(await chama({ cliente: 'Beta' }));
ok('dois clientes com o mesmo nome → 409 (não escolhe um por conta própria)', x.status === 409 && x.j.opcoes.length === 2 && chamadas.length === 0);
x = await lerJson(await chama({ cliente: 'Não Existe' }));
ok('cliente inexistente → 409 sem opções', x.status === 409 && x.j.opcoes.length === 0);
x = await lerJson(await chama({ cliente: '%' }));
ok('curinga "%" não vira "todos os clientes"', x.status === 409 && x.j.opcoes.length === 1 && x.j.opcoes[0].nome === '100%_Real');
x = await lerJson(await chama({ cliente: 'acme filmes' }));
ok('nome exato ignora maiúsculas e vence o parecido ("Acme Filmes Brasil")', x.status === 200 && x.j.cliente.id === 'c1');

// ---- 4) simulação (padrão): lê, mostra, não escreve
cenario();
x = await lerJson(await chama({ cliente: 'Acme Filmes' }));
ok('simulação: 200, modo simulacao, alterou=false', x.status === 200 && x.j.modo === 'simulacao' && x.j.alterou === false);
ok('simulação: ZERO escritas no Drive (só GET)', chamadas.length > 0 && escritas().length === 0);
ok('simulação: banco intacto e sem log', banco() === JSON.stringify(db.projects) && db.projects[0].drive_layout === 'v1' && db.drive_sync_log.length === 0);
ok('simulação: relatório mostra movimentos e a lixeira da REDES; live e v2 pulados', /MOVE\s+03_REDES|MOVE\s+reels\.mp4/.test(x.j.relatorio) && /LIXEIRA\s+03_REDES/.test(x.j.relatorio) && /pulado: live/.test(x.j.relatorio) && /pulado: já é v2/.test(x.j.relatorio));
ok('simulação: resposta não vaza a chave da conta de serviço, o e-mail dela nem o segredo', !JSON.stringify(x.j).includes('PRIVATE KEY') && !JSON.stringify(x.j).includes('sa-teste@x.iam') && !JSON.stringify(x.j).includes(SEGREDO) && !JSON.stringify(x.j).includes('service-role'));
ok('simulação com modo explícito "simulacao" é igual', (await lerJson(await chama({ cliente: 'Acme Filmes', modo: 'simulacao' }))).status === 200 && escritas().length === 0);
x = await lerJson(await chama({ cliente: 'Acme Filmes', projeto: '109' }));
ok('filtro por projeto: o v2 (109) → 200 só com ele pulado', x.status === 200 && x.j.projetos.length === 0 && x.j.pulados.length === 1);
x = await lerJson(await chama({ cliente: 'Acme Filmes', projeto: 'nao-existe' }));
ok('projeto inexistente → 404', x.status === 404);

// ---- 5) executar com confirmação: move no Drive e grava o projeto como v2
cenario();
x = await lerJson(await chama({ cliente: 'Acme Filmes', modo: 'executar', confirmar_cliente: 'acme filmes' }));
ok('executar: 200, alterou=true, sem erro', x.status === 200 && x.j.alterou === true && !x.j.resultado.erro);
const docs = filhos('P1').find(f => f.name === '00_DOCUMENTOS')?.id, exp = filhos('P1').find(f => f.name === '03_EXPORT')?.id;
ok('executar: 01_REVISAO e 02_APROVADO foram para 03_EXPORT (mesmos IDs); 02_FINAL renomeada', drive.get('rev1').parents[0] === exp && drive.get('apr1').parents[0] === exp && drive.get('apr1').name === '02_FINAL');
ok('executar: conteúdo da REDES foi para o FINAL e a REDES (vazia) está na lixeira', drive.get('reels1').parents[0] === 'apr1' && drive.get('rd1').trashed === true);
ok('executar: nada foi excluído de vez (nenhum DELETE), só POST/PATCH', chamadas.every(c => /^(GET|POST|PATCH) /.test(c)));
const u1 = db.projects.find((p: any) => p.id === 'u1');
ok('executar: banco → v2, upload = ID da 01_REVISAO, drive_pastas com os 7 IDs', u1.drive_layout === 'v2' && u1.drive_upload_folder_id === 'rev1' && Object.keys(u1.drive_pastas).sort().join() === 'artes,bruto,documentos,export,final,revisao,trilhas' && u1.drive_pastas.final === 'apr1' && u1.drive_pastas.documentos === docs);
ok('executar: live e v2 não foram tocados (banco e Drive)', db.projects[1].drive_layout === 'v1' && db.projects[1].drive_pastas === null && filhos('P2').length === 1 && filhos('P9').length === 1);
ok('executar: ficou registro no drive_sync_log', db.drive_sync_log.some((l: any) => l.action === 'migracao_v2' && l.status === 'ok' && l.entity_id === 'u1'));
ok('executar: resposta não vaza segredos', !JSON.stringify(x.j).includes('PRIVATE KEY') && !JSON.stringify(x.j).includes(SEGREDO));

// ---- 6) executar de novo: o projeto já é v2, nada acontece
chamadas.length = 0;
x = await lerJson(await chama({ cliente: 'Acme Filmes', modo: 'executar', confirmar_cliente: 'Acme Filmes' }));
ok('executar de novo: projeto já é v2 → pulado, nenhuma escrita', x.status === 200 && escritas().length === 0 && x.j.pulados.some((p: any) => /já é v2/.test(p.motivo)));

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo');
void mod;
process.exit(falhas ? 1 : 0);
