// Testa o review-stream de verdade (Supabase e Drive falsos): o DOWNLOAD só sai depois que o cliente aprovou a versão.
// Rodar:  node --experimental-strip-types scripts/testes-drive/download-so-aprovado.test.mts
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
(globalThis as any).fetch = async (url: string) => {
  const u = new URL(url);
  if (u.hostname === 'oauth2.googleapis.com') return new Response(JSON.stringify({ access_token: 't' }));
  return new Response('BYTES', { status: 200, headers: { 'content-type': 'video/mp4' } }); // o "arquivo" no Drive
};

const db: any = {}; (globalThis as any).__db = db;
await import(pathToFileURL(path.join(aqui, '../../supabase/functions/review-stream/index.ts')).href);
const handler = (globalThis as any).__handler;

let falhas = 0; const ok = (nome: string, c: any) => { console.log((c ? 'OK     ' : 'FALHA  ') + nome); if (!c) falhas++; };
let n = 0;
// Cada cenário usa um token novo (o servidor guarda a resolução por 15s).
function cenario(decisao: string | null, allow = true) {
  const tok = 'tok' + ++n;
  db.review_links = [{ token: tok, active: true, video_version_id: 'v' + n, group_id: 'g' + n, allow_download: allow }];
  db.video_versions = [{ id: 'v' + n, group_id: 'g' + n, versao: 1, drive_file_id: 'f' + n, mime_type: 'video/mp4', file_name: 'Filme_V1.mp4', proxy_file_id: null, transcode_status: null, client_decision: decisao }];
  return tok;
}
const pede = (tok: string, extra = '') => handler(new Request(`http://x/?token=${tok}${extra}`));

let r = await pede(cenario(null), '&download=1');
ok('sem decisão do cliente: download recusado (403)', r.status === 403);
r = await pede(cenario('ajustes'), '&download=1');
ok('cliente pediu ajustes: download recusado', r.status === 403);
r = await pede(cenario(null));
ok('sem decisão: ASSISTIR continua funcionando (200)', r.status === 200);
r = await pede(cenario('aprovado'), '&download=1');
ok('cliente aprovou: download liberado sozinho (200)', r.status === 200);
ok('cliente aprovou: sai como anexo com o nome do arquivo', /attachment; filename="Filme_V1\.mp4"/.test(r.headers.get('content-disposition') || ''));
r = await pede(cenario('aprovado', false), '&download=1');
ok('aprovado, mas a equipe desligou o download do link: continua recusado', r.status === 403);
r = await pede(cenario('aprovado'));
ok('aprovado: assistir continua normal e sem anexo', r.status === 200 && !r.headers.get('content-disposition'));
r = await pede(cenario(null, true), '&download=1&versao=v' + n);
ok('pedir a versão por id também respeita a aprovação', r.status === 403);

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
