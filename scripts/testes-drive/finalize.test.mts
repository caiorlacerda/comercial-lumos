// Testa a aprovação (finalize) do drive-watch de verdade, com Supabase e Drive falsos.
// Rodar:  node --experimental-strip-types scripts/testes-drive/finalize.test.mts
import { register } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.join(aqui, 'hooks.mjs')).href);
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const env: Record<string, string> = {
  SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', DRIVE_SHARED_DRIVE_ID: 'drive', DRIVE_WEBHOOK_SECRET: 'seg',
  GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 't@x.iam', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }),
};
(globalThis as any).Deno = { env: { get: (k: string) => env[k] } };

const FOLDER = 'application/vnd.google-apps.folder';
let drive: Map<string, any>; let n = 0; let escritas: string[] = [];
const filhos = (id: string) => [...drive.values()].filter(x => x.parents.includes(id) && !x.trashed);
const add = (id: string, name: string, pai: string | null, pasta = true) => { drive.set(id, { id, name, parents: pai ? [pai] : [], mimeType: pasta ? FOLDER : 'video/mp4', trashed: false }); return id; };
(globalThis as any).fetch = async (url: string, init: any = {}) => {
  const u = new URL(url); const resp = (o: any, st = 200) => new Response(JSON.stringify(o), { status: st });
  if (u.hostname === 'oauth2.googleapis.com') return resp({ access_token: 't' });
  const rota = u.pathname.replace('/drive/v3/', ''); const m = init.method || 'GET'; const body = init.body ? JSON.parse(init.body) : {};
  if (m === 'GET' && rota === 'files') { const pai = /'([^']+)' in parents/.exec(u.searchParams.get('q')!)![1]; return resp({ files: filhos(pai).map(x => ({ id: x.id, name: x.name, mimeType: x.mimeType })) }); }
  if (m === 'POST' && rota === 'files') { escritas.push('criar ' + body.name); return resp({ id: add('n' + ++n, body.name, body.parents[0], body.mimeType === FOLDER) }); }
  if (m === 'POST' && rota.endsWith('/copy')) { escritas.push('copiar ' + body.name); return resp({ id: add('c' + ++n, body.name, body.parents[0], false) }); }
  return resp({ error: { message: 'rota ' + m + ' ' + rota } }, 400);
};

const db: any = {}; (globalThis as any).__db = db;
await import(pathToFileURL(path.join(aqui, '../../supabase/functions/drive-watch/index.ts')).href);
const handler = (globalThis as any).__handler;
const finalizar = async (id: string) => handler(new Request('http://x', { method: 'POST', headers: { 'x-drive-secret': 'seg' }, body: JSON.stringify({ action: 'finalize', version_id: id }) }));
const caminho = (id: string): string => { const x = drive.get(id); return x.parents.length ? caminho(x.parents[0]) + '/' + x.name : x.name; };

let falhas = 0; const ok = (nome: string, c: any) => { console.log((c ? 'OK     ' : 'FALHA  ') + nome); if (!c) falhas++; };
function cenario(projeto: any) {
  drive = new Map(); n = 0; escritas = [];
  add('drive', 'DRIVE', null); add('proj', '227_FILME', 'drive'); add('orig', 'Filme_V1.mp4', 'proj', false);
  for (const k of Object.keys(db)) delete db[k];
  db.projects = [{ id: 'p1', drive_folder_id: 'proj', ...projeto }];
  db.video_versions = [{ id: 'v1', project_id: 'p1', file_name: 'Filme_V1.mp4', drive_file_id: 'orig', approved_file_id: null, status: 'EM_REVISAO_CLIENTE' }];
  db.drive_sync_log = [];
}

// v2: copia para 03_EXPORT/02_FINAL pelo ID e NÃO cria pasta nenhuma
cenario({ drive_layout: 'v2', drive_pastas: { final: 'fin' } });
add('fin', '02_FINAL', add('exp', '03_EXPORT', 'proj'));
let r = await finalizar('v1');
ok('v2: responde 200', r.status === 200);
ok('v2: vFINAL copiado para 03_EXPORT/02_FINAL com _APROVADO', filhos('fin').some(x => x.name === 'Filme_V1_APROVADO.mp4'));
ok('v2: nenhuma pasta criada (não recria 06_ENTREGA/02_APROVADO)', !escritas.some(e => e.startsWith('criar')) && filhos('proj').every(x => x.name !== '06_ENTREGA'));
ok('v2: versão marcada APROVADO com o ID da cópia', db.video_versions[0].status === 'APROVADO' && !!db.video_versions[0].approved_file_id);
ok('v2: o original continua onde estava', drive.get('orig').parents[0] === 'proj');
ok('v2: log diz 03_EXPORT/02_FINAL', db.drive_sync_log.some((l: any) => /03_EXPORT\/02_FINAL/.test(l.detail)));

// v2 sem o ID da pasta final: falha sem criar nada
cenario({ drive_layout: 'v2', drive_pastas: { revisao: 'rev' } });
r = await finalizar('v1');
ok('v2 sem 02_FINAL registrada: erro, nada criado, nada copiado', r.status >= 400 && escritas.length === 0 && db.video_versions[0].approved_file_id === null);

// v1: comportamento de sempre (cria 06_ENTREGA/02_APROVADO se faltar)
cenario({ drive_layout: 'v1', drive_pastas: null });
r = await finalizar('v1');
const apr = filhos(filhos('proj').find(x => x.name === '06_ENTREGA')?.id ?? 'x').find(x => x.name === '02_APROVADO');
ok('v1: cria 06_ENTREGA/02_APROVADO e copia para lá', r.status === 200 && !!apr && filhos(apr.id).some(x => x.name === 'Filme_V1_APROVADO.mp4'));

// banco antigo (sem as colunas): igual ao v1
cenario({});
r = await finalizar('v1');
ok('sem colunas v2: comportamento v1', r.status === 200 && filhos('proj').some(x => x.name === '06_ENTREGA'));

// idempotência
cenario({ drive_layout: 'v2', drive_pastas: { final: 'fin' } }); add('fin', '02_FINAL', 'proj');
db.video_versions[0].approved_file_id = 'ja-copiado';
await finalizar('v1');
ok('já finalizado: não copia de novo', escritas.length === 0);

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo');
process.exit(falhas ? 1 : 0);
