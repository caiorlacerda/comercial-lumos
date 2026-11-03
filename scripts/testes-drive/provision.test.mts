// Testa a edge function drive-provision de verdade (o index.ts real), com Supabase e Drive falsos em memória.
// Rodar:  node --experimental-strip-types scripts/testes-drive/provision.test.mts
import { register } from 'node:module';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.join(aqui, 'hooks.mjs')).href);

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const env: Record<string, string> = {
  SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', DRIVE_SHARED_DRIVE_ID: 'drive', DRIVE_CLIENTES_FOLDER_ID: 'clientes',
  DRIVE_TEMPLATES_FOLDER_ID: 'templates', DRIVE_WEBHOOK_SECRET: 'seg',
  GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 't@x.iam', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }),
};
(globalThis as any).Deno = { env: { get: (k: string) => env[k] } };

// ---------- Drive falso ----------
const FOLDER = 'application/vnd.google-apps.folder';
let drive: Map<string, any>; let t = 0; let n = 0; let escritas: string[] = [];
const filhos = (id: string) => [...drive.values()].filter(x => x.parents.includes(id) && !x.trashed);
const add = (id: string, name: string, pai: string | null, pasta = true) => { drive.set(id, { id, name, parents: pai ? [pai] : [], mimeType: pasta ? FOLDER : 'text/plain', trashed: false, createdTime: String(1000 + t++).padStart(8, '0') }); return id; };
const caminho = (id: string): string => { const x = drive.get(id); return x.parents.length ? caminho(x.parents[0]) + '/' + x.name : x.name; };
const porNome = (pai: string, nome: string) => filhos(pai).filter(x => x.name === nome);

(globalThis as any).fetch = async (url: string, init: any = {}) => {
  const u = new URL(url); const resp = (o: any, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json' } });
  if (u.hostname === 'oauth2.googleapis.com') return resp({ access_token: 't' });
  const rota = u.pathname.replace('/drive/v3/', ''); const m = init.method || 'GET'; const body = init.body ? JSON.parse(init.body) : {};
  if (m === 'GET' && rota === 'files') {
    const pai = /'([^']+)' in parents/.exec(u.searchParams.get('q')!)![1];
    return resp({ files: filhos(pai).map(x => ({ id: x.id, name: x.name, mimeType: x.mimeType, createdTime: x.createdTime })) });
  }
  if (m === 'POST' && rota === 'files') { escritas.push('criar ' + body.name); return resp({ id: add('n' + ++n, body.name, body.parents[0], body.mimeType === FOLDER) }); }
  if (m === 'POST' && rota.endsWith('/copy')) { escritas.push('copiar ' + body.name); return resp({ id: add('c' + ++n, body.name, body.parents[0], false) }); }
  const mm = /^files\/([^/]+)$/.exec(rota);
  if (mm && m === 'GET') { const x = drive.get(mm[1]); return x ? resp({ id: x.id, name: x.name, trashed: x.trashed, parents: x.parents }) : resp({ error: { message: 'nao existe' } }, 404); }
  if (mm && m === 'PATCH') { escritas.push('renomear ' + body.name); drive.get(mm[1]).name = body.name; return resp({ id: mm[1] }); }
  return resp({ error: { message: 'rota ' + m + ' ' + rota } }, 400);
};

// ---------- banco falso ----------
const db: any = {}; (globalThis as any).__db = db;
await import(pathToFileURL(path.join(aqui, '../../supabase/functions/drive-provision/index.ts')).href);
const handler = (globalThis as any).__handler;
const provisionar = async (id: string) => { const r = await handler(new Request('http://x', { method: 'POST', headers: { 'x-drive-secret': 'seg' }, body: JSON.stringify({ project_id: id }) })); return r.status; };

function cenario(clientes: any[], projetos: any[], opts: { semColunasV2?: boolean } = {}) {
  drive = new Map(); t = 0; n = 0; escritas = [];
  add('drive', 'DRIVE', null); add('clientes', 'Clientes', 'drive'); add('templates', '_TEMPLATES', 'drive');
  add('t-assets', '_ASSETS', 'templates'); add('t-assets-bb', 'BRAND-BOOK', 't-assets');
  add('t-p', '_TEMPLATE_PROJETO', 'templates'); add('t-p-in', 'NNN_NOMEPROJETO', 't-p');
  add('t-p-0', '00_GERAL', 't-p-in'); add('t-p-e', '06_ENTREGA', 't-p-in'); add('t-p-r', '01_REVISAO', 't-p-e'); add('t-p-a', '02_APROVADO', 't-p-e');
  add('t-l', '_TEMPLATE_LIVE', 'templates'); add('t-l-in', 'NNN_NOMEPROJETO_LIVE', 't-l'); add('t-l-0', '00_GERAL', 't-l-in'); add('t-l-3', '03_TRANSMISSAO', 't-l-in');
  for (const k of Object.keys(db)) delete db[k];
  db.clients = clientes.map(c => ({ drive_folder_id: null, ...c }));
  db.projects = projetos.map(p => { const o: any = { code: '2026-227', name: 'Mini Missão', status: 'ativo', category: 'digital', budget_id: null, data_inicio: null, created_at: '2026-10-15T12:00:00Z', drive_folder_id: null, drive_upload_folder_id: null, client_id: 'c1', ...p }; if (!opts.semColunasV2) { o.drive_layout ??= 'v1'; o.drive_pastas ??= null; o.marca ??= null; } return o; });
  db.drive_sync_log = [];
}
let falhas = 0; const ok = (nome: string, c: any) => { console.log((c ? 'OK     ' : 'FALHA  ') + nome); if (!c) falhas++; };
const proj = (id: string) => db.projects.find((p: any) => p.id === id);
const pastasV2 = ['00_DOCUMENTOS', '01_BRUTO', '02_ARTES', '02_ARTES/01_TRILHAS', '03_EXPORT', '03_EXPORT/01_REVISAO', '03_EXPORT/02_FINAL'];
const cli = { id: 'c1', name: 'Acme', marcas: [] as string[] };

// 1) projeto novo, cliente sem marcas
cenario([cli], [{ id: 'p1' }]);
ok('retorna 202', (await provisionar('p1')) === 202);
const p1 = proj('p1');
const raiz = p1.drive_folder_id;
ok('pasta v2 em Clientes/Acme/2026-10/227_MINI-MISSAO', caminho(raiz) === 'DRIVE/Clientes/Acme/2026-10/227_MINI-MISSAO');
ok('as 5 subpastas + 2 filhas existem, criadas por código', pastasV2.every(c => { const [a, b] = c.split('/'); const pa = porNome(raiz, a)[0]; return pa && (!b || porNome(pa.id, b)[0]); }));
ok('NÃO copia nada do template (sem 06_ENTREGA nem 00_GERAL no projeto)', porNome(raiz, '06_ENTREGA').length === 0 && porNome(raiz, '00_GERAL').length === 0);
ok('banco: layout v2, 7 IDs, upload = 01_REVISAO', p1.drive_layout === 'v2' && Object.keys(p1.drive_pastas).length === 7 && p1.drive_upload_folder_id === p1.drive_pastas.revisao && caminho(p1.drive_pastas.revisao).endsWith('03_EXPORT/01_REVISAO') && caminho(p1.drive_pastas.final).endsWith('03_EXPORT/02_FINAL') && caminho(p1.drive_pastas.documentos).endsWith('/00_DOCUMENTOS'));
ok('cliente ganhou a pasta e a _ASSETS', !!db.clients[0].drive_folder_id && porNome(db.clients[0].drive_folder_id, '_ASSETS').length === 1);

// 2) segundo projeto no mesmo mês reaproveita a pasta do mês
db.projects.push({ ...proj('p1'), id: 'p2', code: '2026-228', name: 'Outro', drive_folder_id: null, drive_upload_folder_id: null, drive_layout: 'v1', drive_pastas: null });
await provisionar('p2');
const cliPasta = db.clients[0].drive_folder_id;
ok('mesmo mês: uma única pasta 2026-10', porNome(cliPasta, '2026-10').length === 1 && caminho(proj('p2').drive_folder_id) === 'DRIVE/Clientes/Acme/2026-10/228_OUTRO');

// 3) idempotência: rodar de novo não cria nada
escritas = []; const antes = drive.size;
await provisionar('p1');
ok('rodar de novo: nada criado, nada renomeado', drive.size === antes && escritas.length === 0);

// 4) renomeia quando o nome muda e a pasta está no lugar
proj('p1').name = 'Mini Missão 2';
await provisionar('p1');
ok('nome mudou e a pasta está no lugar → renomeia', drive.get(raiz).name === '227_MINI-MISSAO-2' && drive.size === antes);

// 5) pasta MOVIDA para outro pai: não recria nem renomeia
const outroPai = add('arquivo', 'Arquivo', 'drive'); drive.get(raiz).parents = [outroPai];
proj('p1').name = 'Mini Missão 3'; escritas = []; const antes2 = drive.size;
await provisionar('p1');
ok('pasta movida: não cria outra', drive.size === antes2 && proj('p1').drive_folder_id === raiz);
ok('pasta movida: não renomeia', drive.get(raiz).name === '227_MINI-MISSAO-2' && escritas.length === 0);
ok('pasta movida: registra o motivo no log', db.drive_sync_log.some((l: any) => l.action === 'skip_rename'));

// 6) pasta na lixeira: recria
drive.get(raiz).trashed = true;
await provisionar('p1');
ok('pasta na lixeira: cria uma nova e regrava o ID', proj('p1').drive_folder_id !== raiz && proj('p1').drive_layout === 'v2');

// 7) mês pelo fuso de São Paulo
cenario([cli], [{ id: 'p1', created_at: '2026-11-01T01:00:00Z' }]);
await provisionar('p1');
ok('criado 31/10 22h (SP) = 01/11 01h UTC → pasta 2026-10', caminho(proj('p1').drive_folder_id).includes('/2026-10/'));
cenario([cli], [{ id: 'p1', created_at: '2026-10-15T12:00:00Z', data_inicio: '2026-12-03' }]);
await provisionar('p1');
ok('data_inicio manda: 2026-12', caminho(proj('p1').drive_folder_id).includes('/2026-12/'));

// 8) cliente com marcas: espera a marca
const vitru = { id: 'c1', name: 'Vitru', marcas: ['Uniasselvi', 'Continuada', 'Vitru'] };
cenario([vitru], [{ id: 'p1' }]);
await provisionar('p1');
ok('cliente com marcas e projeto sem marca: NÃO cria a pasta do projeto', proj('p1').drive_folder_id === null && drive.size > 0 && ![...drive.values()].some(x => x.name === '227_MINI-MISSAO'));
await provisionar('p1');
ok('...e o aviso fica registrado uma única vez', db.drive_sync_log.filter((l: any) => l.action === 'wait_marca').length === 1);
proj('p1').marca = 'Uniasselvi';
await provisionar('p1');
ok('marca escolhida: Vitru/Uniasselvi/2026-10/227_MINI-MISSAO', caminho(proj('p1').drive_folder_id) === 'DRIVE/Clientes/Vitru/Uniasselvi/2026-10/227_MINI-MISSAO' && proj('p1').drive_layout === 'v2');
db.projects.push({ ...proj('p1'), id: 'p2', code: '2026-230', name: 'Outro', marca: 'Vitru', drive_folder_id: null, drive_upload_folder_id: null, drive_layout: 'v1', drive_pastas: null });
await provisionar('p2');
ok('outra marca do mesmo cliente tem a própria pasta', caminho(proj('p2').drive_folder_id) === 'DRIVE/Clientes/Vitru/Vitru/2026-10/230_OUTRO');

// 9) live: segue o template antigo, v1, direto no cliente
cenario([cli], [{ id: 'p1', category: 'live' }]);
await provisionar('p1');
const pl = proj('p1');
ok('live: pasta direto no cliente com sufixo _LIVE', caminho(pl.drive_folder_id) === 'DRIVE/Clientes/Acme/227_MINI-MISSAO_LIVE');
ok('live: copiou o template de live e continua v1', porNome(pl.drive_folder_id, '03_TRANSMISSAO').length === 1 && pl.drive_layout === 'v1' && pl.drive_pastas === null);
cenario([vitru], [{ id: 'p1', category: 'live' }]);
await provisionar('p1');
ok('live de cliente com marcas NÃO espera marca (segue v1)', !!proj('p1').drive_folder_id);

// 10) projeto antigo (v1) com pasta: nunca vira v2 sozinho e não recria nada
cenario([cli], [{ id: 'p1' }]);
const cp = add('cli1', 'Acme', 'clientes'); db.clients[0].drive_folder_id = cp; add('t-assets-x', '_ASSETS', cp);
const velho = add('velho', '227_MINI-MISSAO', cp); const ent = add('ent', '06_ENTREGA', velho); const rev = add('rev', '01_REVISAO', ent);
proj('p1').drive_folder_id = velho; const antes3 = drive.size; escritas = [];
await provisionar('p1');
ok('v1 existente: continua v1, nada criado', proj('p1').drive_layout === 'v1' && drive.size === antes3 && escritas.length === 0);
ok('v1 existente: preenche o ID da revisão que faltava', proj('p1').drive_upload_folder_id === rev);

// 11) projeto v1 alterado e movido para outro pai: não duplica (o bug do folderUnder)
drive.get(velho).parents = [add('mes', '2026-10', cp)]; proj('p1').name = 'Renomeado'; const antes4 = drive.size;
await provisionar('p1');
ok('v1 movido para a pasta do mês: não cria outra pasta de projeto', drive.size === antes4 && proj('p1').drive_folder_id === velho);

// 12) banco sem as colunas v2 (migration pendente): comportamento antigo
cenario([cli], [{ id: 'p1' }], { semColunasV2: true });
await provisionar('p1');
ok('sem colunas v2: cria no layout antigo (template), sem escrever drive_layout', caminho(proj('p1').drive_folder_id) === 'DRIVE/Clientes/Acme/227_MINI-MISSAO' && porNome(proj('p1').drive_folder_id, '06_ENTREGA').length === 1 && !('drive_layout' in proj('p1')));

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo');
process.exit(falhas ? 1 : 0);
