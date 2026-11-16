// Testa a pasta de materiais fixos da boas-vindas-upload (MARCA ou _ASSETS) com Supabase e Drive falsos.
// Rodar:  node --experimental-strip-types scripts/testes-drive/boasvindas.test.mts
import { register } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.join(aqui, 'hooks.mjs')).href);
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const env: Record<string, string> = {
  SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', DRIVE_SHARED_DRIVE_ID: 'drive', DRIVE_CLIENTES_FOLDER_ID: 'clientes', DRIVE_TEMPLATES_FOLDER_ID: 'templates',
  GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 't@x.iam', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }),
};
(globalThis as any).Deno = { env: { get: (k: string) => env[k] } };

const FOLDER = 'application/vnd.google-apps.folder';
let drive: Map<string, any>; let n = 0;
const filhos = (id: string) => [...drive.values()].filter(x => x.parents.includes(id) && !x.trashed);
const add = (id: string, name: string, pai: string | null, pasta = true) => { drive.set(id, { id, name, parents: pai ? [pai] : [], mimeType: pasta ? FOLDER : 'text/plain', trashed: false }); return id; };
const porNome = (pai: string, nome: string) => filhos(pai).filter(x => x.name === nome);
(globalThis as any).fetch = async (url: string, init: any = {}) => {
  const u = new URL(url); const resp = (o: any, st = 200) => new Response(JSON.stringify(o), { status: st });
  if (u.hostname === 'oauth2.googleapis.com') return resp({ access_token: 't' });
  const rota = u.pathname.replace('/drive/v3/', ''); const m = init.method || 'GET'; const body = init.body ? JSON.parse(init.body) : {};
  if (m === 'GET' && rota === 'files') {
    // O Drive de verdade filtra pelo que vem no q: pai, nome e tipo.
    const q = u.searchParams.get('q')!; const pai = /'([^']+)' in parents/.exec(q)![1];
    const nome = /name='((?:[^'\\]|\\.)*)'/.exec(q)?.[1]; const soPasta = /mimeType='application\/vnd\.google-apps\.folder'/.test(q);
    return resp({ files: filhos(pai).filter(x => (!nome || x.name === nome) && (!soPasta || x.mimeType === FOLDER)).map(x => ({ id: x.id, name: x.name, mimeType: x.mimeType })) });
  }
  if (m === 'POST' && rota === 'files') return resp({ id: add('n' + ++n, body.name, body.parents[0], body.mimeType === FOLDER) });
  if (m === 'POST' && rota.endsWith('/copy')) return resp({ id: add('c' + ++n, body.name, body.parents[0], false) });
  const mm = /^files\/([^/]+)$/.exec(rota);
  if (mm && m === 'GET') { const x = drive.get(mm[1]); return x ? resp({ id: x.id, name: x.name, trashed: x.trashed, parents: x.parents }) : resp({ error: { message: 'nao existe' } }, 404); }
  return resp({ error: { message: 'rota ' + m + ' ' + rota } }, 400);
};
const db: any = { clients: [], drive_sync_log: [] }; (globalThis as any).__db = db;
const mod: any = await import(pathToFileURL(path.join(aqui, '../../supabase/functions/boas-vindas-upload/index.ts')).href);

function cenario(clientFolder: string | null) {
  drive = new Map(); n = 0;
  add('drive', 'DRIVE', null); add('clientes', 'Clientes', 'drive'); add('templates', '_TEMPLATES', 'drive');
  add('t-assets', '_ASSETS', 'templates'); add('t-bb', 'BRAND-BOOK', 't-assets'); add('t-lg', 'LOGOS', 't-assets');
  db.clients = [{ id: 'c1', name: 'Acme', drive_folder_id: clientFolder }]; db.drive_sync_log = [];
}
let falhas = 0; const ok = (nome: string, c: any) => { console.log((c ? 'OK     ' : 'FALHA  ') + nome); if (!c) falhas++; };
const cli = () => ({ id: 'c1', name: 'Acme', drive_folder_id: db.clients[0].drive_folder_id });

// 1) cliente novo: Marca (do template, que pode estar como MARCA) + GUIDELINES + Projetos; sem _ASSETS
cenario(null);
let id = await mod.ensureClientAssetsFolder(cli());
let pasta = db.clients[0].drive_folder_id;
ok('cliente novo: devolve a pasta Marca', drive.get(id).name === 'Marca' && drive.get(id).parents[0] === pasta);
ok('cliente novo: Marca traz as subpastas do template e a Guidelines, só com a primeira maiúscula', ['Brand-book', 'Logos', 'Guidelines'].every(x => porNome(id, x).length === 1) && !filhos(id).some(x => x.name === 'BRAND-BOOK' || x.name === 'LOGOS'));
ok('cliente novo: ganha Projetos e não ganha _ASSETS', porNome(pasta, 'Projetos').length === 1 && porNome(pasta, '_ASSETS').length === 0);

// 2) cliente antigo com _ASSETS: usa a _ASSETS, não cria MARCA nem Projetos
cenario('cli'); add('cli', 'Acme', 'clientes'); add('as', '_ASSETS', 'cli'); add('lg', 'LOGOS', 'as');
id = await mod.ensureClientAssetsFolder(cli());
ok('cliente antigo: usa a _ASSETS existente (mesmo ID)', id === 'as' && drive.get('as').name === '_ASSETS');
ok('cliente antigo: garante a Guidelines dentro dela; não cria Marca nem Projetos', porNome('as', 'Guidelines').length === 1 && porNome('cli', 'MARCA').length === 0 && porNome('cli', 'Marca').length === 0 && porNome('cli', 'Projetos').length === 0);
const antes = drive.size;
await mod.ensureClientAssetsFolder(cli());
ok('rodar de novo não cria nada', drive.size === antes);

// 3) cliente com MARCA: usa a MARCA
cenario('cli'); add('cli', 'Acme', 'clientes'); add('mr', 'MARCA', 'cli');
id = await mod.ensureClientAssetsFolder(cli());
ok('cliente com MARCA (nome antigo): usa a existente, sem criar Marca ao lado', id === 'mr' && porNome('cli', 'MARCA').length === 1 && porNome('cli', 'Marca').length === 0 && porNome('cli', '_ASSETS').length === 0);
// 3b) cliente com Marca (nome novo) e marca em minúsculas: também é a mesma
cenario('cli'); add('cli', 'Acme', 'clientes'); add('mn', 'Marca', 'cli');
id = await mod.ensureClientAssetsFolder(cli());
ok('cliente com Marca (nome novo): usa a existente', id === 'mn' && porNome('cli', 'Marca').length === 1 && porNome('cli', 'MARCA').length === 0);

// 4) tem MARCA e _ASSETS ao mesmo tempo: prefere a MARCA (a nova)
cenario('cli'); add('cli', 'Acme', 'clientes'); add('mr', 'MARCA', 'cli'); add('as', '_ASSETS', 'cli');
id = await mod.ensureClientAssetsFolder(cli());
ok('MARCA e _ASSETS juntas: prefere a MARCA', id === 'mr');

// 5) cliente existente sem nenhuma das duas: cria MARCA (do template)
cenario('cli'); add('cli', 'Acme', 'clientes');
id = await mod.ensureClientAssetsFolder(cli());
ok('cliente existente sem pasta de materiais: cria Marca com o template', drive.get(id).name === 'Marca' && porNome(id, 'Brand-book').length === 1 && porNome(id, 'Guidelines').length === 1 && porNome('cli', '_ASSETS').length === 0);

// 6) _ASSETS antiga com subpastas em CAIXA ALTA (como existem hoje): a Guidelines e o checklist reaproveitam, não duplicam
cenario('cli'); add('cli', 'Acme', 'clientes'); add('as', '_ASSETS', 'cli'); add('lg', 'LOGOS', 'as'); add('bb', 'BRAND-BOOK', 'as'); add('gl', 'GUIDELINES', 'as');
id = await mod.ensureClientAssetsFolder(cli());
ok('_ASSETS com GUIDELINES em caixa alta: não cria Guidelines ao lado', id === 'as' && porNome('as', 'Guidelines').length === 0 && porNome('as', 'GUIDELINES').length === 1);
const sub = async (chave: string) => mod.ensureFolderIgnorandoCaixa('as', mod.PASTA_LEGADO[chave] ?? mod.nomeSubpasta(chave));
ok('checklist: logo acha a LOGOS antiga (mesmo ID, sem criar Logos)', (await sub('logo')) === 'lg' && porNome('as', 'Logos').length === 0);
ok('checklist: brand_book acha a BRAND-BOOK antiga (mesmo ID, sem criar Brand-book)', (await sub('brand_book')) === 'bb' && porNome('as', 'Brand-book').length === 0);
ok('checklist: guidelines acha a GUIDELINES antiga (mesmo ID)', (await sub('guidelines')) === 'gl');
const ref1 = await sub('referencias'); const ref2 = await sub('referencias');
ok('checklist: item novo (referencias) nasce como Referencias, e pedir de novo (ou como REFERENCIAS) devolve a mesma', drive.get(ref1).name === 'Referencias' && ref1 === ref2 && (await mod.ensureFolderIgnorandoCaixa('as', 'REFERENCIAS')) === ref1);
ok('nomes das pastas do checklist: só a primeira maiúscula', mod.nomeSubpasta('brand_book') === 'Brand-book' && mod.nomeSubpasta('calendario_semestre') === 'Calendario-semestre' && mod.nomeSubpasta('referencias') === 'Referencias' && mod.nomeSubpasta('guidelines') === 'Guidelines' && mod.PASTA_LEGADO.logo === 'Logos');

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo');
process.exit(falhas ? 1 : 0);
