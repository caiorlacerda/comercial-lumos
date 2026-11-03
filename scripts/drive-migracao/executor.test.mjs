// Testa o executor inteiro contra um Drive FALSO em memória (nenhuma chamada ao Google).
// Rodar:  node scripts/drive-migracao/executor.test.mjs
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
let falhas = 0;
const ok = (n, c) => { console.log((c ? 'OK     ' : 'FALHA  ') + n); if (!c) falhas++; };

// ---------- Drive falso ----------
const FOLDER = 'application/vnd.google-apps.folder';
let arvore, chamadas, seq;
const add = (id, name, parent, folder = true) => arvore.set(id, { id, name, parents: parent ? [parent] : [], mimeType: folder ? FOLDER : 'text/plain' });
function novo() {
  arvore = new Map(); chamadas = []; seq = 0;
  add('drive', 'DRIVE', null);
  add('cli', 'Cliente Teste', 'drive');
  add('assets', '_ASSETS', 'cli'); add('logos', 'LOGOS', 'assets');
  // P1: projeto antigo típico
  add('p1', '227_FILME', 'cli');
  for (const [id, n] of [['g0', '00_GERAL'], ['g1', '01_ROTEIRO'], ['g2', '02_PRODUCAO'], ['g3', '03_CAPTACAO'], ['g4', '04_EDICAO'], ['g5', '05_ARTES'], ['ent', '06_ENTREGA'], ['os', 'OS'], ['dup', '99_DUPLICADOS']]) add(id, n, 'p1');
  add('leia', 'leia-me.txt', 'p1', false);
  add('rev', '01_REVISAO', 'ent'); add('apr', '02_APROVADO', 'ent');
  add('v1', 'video_V1.mp4', 'rev', false); add('v1a', 'video_V1_APROVADO.mp4', 'apr', false);
  // P2 live, P3 já v2: não podem ser tocados
  add('p2', '228_SHOW_LIVE', 'cli'); add('p2x', '00_GERAL', 'p2');
  add('p3', '229_NOVO', 'cli');
}
const filhos = id => [...arvore.values()].filter(n => n.parents.includes(id));
const corpo = req => new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b ? JSON.parse(b) : {})); });

const servidor = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const json = (o, st = 200) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/token') return json({ access_token: 't' });
  chamadas.push(`${req.method} ${u.pathname}`);
  const m = u.pathname.match(/^\/files(?:\/(.+))?$/);
  if (!m) return json({ error: { message: 'rota' } }, 404);
  if (req.method === 'GET' && !m[1]) {
    const pai = /'([^']+)' in parents/.exec(u.searchParams.get('q'))[1];
    return json({ files: filhos(pai).map(f => ({ id: f.id, name: f.name, mimeType: f.mimeType })) });
  }
  if (req.method === 'GET') { const n = arvore.get(m[1]); return n ? json({ id: n.id, name: n.name, parents: n.parents }) : json({ error: { message: 'nao existe' } }, 404); }
  if (req.method === 'POST') { const b = await corpo(req); const id = 'novo' + (++seq); arvore.set(id, { id, name: b.name, parents: b.parents, mimeType: b.mimeType }); return json({ id }); }
  if (req.method === 'PATCH') {
    const n = arvore.get(m[1]); const b = await corpo(req);
    const add = u.searchParams.get('addParents'); const rem = (u.searchParams.get('removeParents') || '').split(',').filter(Boolean);
    if (add) n.parents = [...n.parents.filter(p => !rem.includes(p)), add];
    if (b.name) n.name = b.name;
    return json({ id: n.id });
  }
  return json({ error: { message: 'metodo' } }, 405);
});
await new Promise(r => servidor.listen(0, r));
const porta = servidor.address().port;

// ---------- arquivos de entrada ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drivemig-'));
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
fs.writeFileSync(path.join(tmp, 'sa.json'), JSON.stringify({ client_email: 'teste@x.iam', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
const proj = (id, code, name, extra) => ({ id: 'uuid-' + id, code, name, status: 'ativo', category: 'digital', layout: 'v1', marca: null, data_inicio: null, created_at: '2026-10-15T12:00:00Z', drive_folder_id: id, drive_upload_folder_id: null, client_id: 'c1', client_name: 'Cliente Teste', client_drive_folder_id: 'cli', client_marcas: [], ...extra });
fs.writeFileSync(path.join(tmp, 'projetos.json'), JSON.stringify([
  proj('p1', '227', 'FILME', {}),
  proj('p2', '228', 'SHOW_LIVE', { category: 'live' }),
  proj('p3', '229', 'NOVO', { layout: 'v2' }),
]));

function rodar(extra, entrada) {
  return new Promise(resolve => {
    const f = spawn(process.execPath, [path.join(aqui, 'migrar-projetos-v2.mjs'), '--projetos', path.join(tmp, 'projetos.json'), '--sa', path.join(tmp, 'sa.json'),
      '--drive-id', 'drive', '--cliente', 'Cliente Teste', '--saida', path.join(tmp, 'saida'), ...extra],
      { env: { ...process.env, DRIVE_API_BASE: `http://127.0.0.1:${porta}`, GOOGLE_TOKEN_URL: `http://127.0.0.1:${porta}/token` } });
    let out = ''; f.stdout.on('data', d => out += d); f.stderr.on('data', d => out += d);
    if (entrada !== undefined) f.stdin.end(entrada); else f.stdin.end();
    f.on('close', code => resolve({ code, out }));
  });
}
const pai = id => arvore.get(id)?.parents[0];
const nome = id => arvore.get(id)?.name;

// ---------- 1) simulação: não pode alterar nada ----------
novo();
let r = await rodar([]);
ok('simulação: terminou sem erro', r.code === 0);
ok('simulação: NENHUMA escrita no Drive (só GET)', chamadas.length > 0 && chamadas.every(c => c.startsWith('GET ')));
ok('simulação: mostra os movimentos e avisa que nada mudou', /MOVE\s+00_GERAL/.test(r.out) && /nada foi alterado/i.test(r.out));
ok('simulação: live e v2 são pulados', /SHOW_LIVE\s+→ pulado: live/.test(r.out) && /NOVO\s+→ pulado: já é v2/.test(r.out));
ok('simulação: estrutura intacta', pai('g0') === 'p1' && nome('apr') === '02_APROVADO' && pai('rev') === 'ent');

// ---------- 2) execução com confirmação errada: nada acontece ----------
novo();
r = await rodar(['--executar'], 'outro nome\n');
ok('confirmação errada: aborta e não escreve nada', r.code !== 0 && chamadas.every(c => c.startsWith('GET ')));

// ---------- 3) execução de verdade ----------
novo();
r = await rodar(['--executar'], 'Cliente Teste\n');
ok('execução: terminou sem erro', r.code === 0);
const docs = filhos('p1').find(f => f.name === '00_DOCUMENTOS')?.id;
const bruto = filhos('p1').find(f => f.name === '01_BRUTO')?.id;
const artes = filhos('p1').find(f => f.name === '02_ARTES')?.id;
const exp = filhos('p1').find(f => f.name === '03_EXPORT')?.id;
ok('execução: 00_DOCUMENTOS, 01_BRUTO, 02_ARTES e 03_EXPORT criadas na raiz do projeto', docs && bruto && artes && exp);
ok('execução: 00/01/02 e OS dentro de 00_DOCUMENTOS (mesmos IDs)', ['g0', 'g1', 'g2', 'os'].every(id => pai(id) === docs));
ok('execução: 03_CAPTACAO dentro de 01_BRUTO; 04 e 05 dentro de 02_ARTES', pai('g3') === bruto && pai('g4') === artes && pai('g5') === artes);
ok('execução: 01_TRILHAS criada dentro de 02_ARTES', filhos(artes).some(f => f.name === '01_TRILHAS'));
ok('execução: 01_REVISAO e 02_APROVADO agora em 03_EXPORT, com o MESMO ID', pai('rev') === exp && pai('apr') === exp);
ok('execução: 02_APROVADO virou 02_FINAL; 01_REVISAO manteve o nome', nome('apr') === '02_FINAL' && nome('rev') === '01_REVISAO');
ok('execução: os vídeos continuam onde estavam dentro das pastas (IDs intactos)', pai('v1') === 'rev' && pai('v1a') === 'apr');
ok('execução: 06_ENTREGA continua existindo, com o mesmo nome e vazia', pai('ent') === 'p1' && nome('ent') === '06_ENTREGA' && filhos('ent').length === 0);
ok('execução: 99_DUPLICADOS e o arquivo solto não saíram do lugar', pai('dup') === 'p1' && pai('leia') === 'p1');
ok('execução: live e v2 não foram tocados', filhos('p2').length === 1 && pai('p2x') === 'p2' && filhos('p3').length === 0);
ok('execução: nunca houve DELETE nem cópia', !chamadas.some(c => c.startsWith('DELETE') || c.includes('/copy')));
ok('execução: avisa que 06_ENTREGA ficou vazia', /06_ENTREGA/.test(r.out) && /VAZIAS/.test(r.out));
const sqlArq = fs.readdirSync(path.join(tmp, 'saida')).find(f => f.startsWith('atualizar-banco-'));
const sql = fs.readFileSync(path.join(tmp, 'saida', sqlArq), 'utf8');
ok('SQL gerado para o projeto migrado, com a revisão = ID antigo de 01_REVISAO', /uuid-p1/.test(sql) && /drive_upload_folder_id = 'rev'/.test(sql) && /"final":"apr"/.test(sql) && /"documentos":"/.test(sql));
ok('SQL não inclui live nem v2', !/uuid-p2|uuid-p3/.test(sql));
ok('registro do que foi feito foi salvo (para desfazer à mão)', fs.readdirSync(path.join(tmp, 'saida')).some(f => f.startsWith('feito-')));

// ---------- 4) --mover-para-mes: Cliente › PROJETOS › AAAA-MM ----------
novo();
r = await rodar(['--executar', '--mover-para-mes'], 'Cliente Teste\n');
const projetos = filhos('cli').find(f => f.name === 'PROJETOS')?.id;
const mes = filhos(projetos ?? 'x').find(f => f.name === '2026-10')?.id;
ok('--mover-para-mes: cria Cliente/PROJETOS/2026-10', !!projetos && !!mes);
ok('--mover-para-mes: a pasta do projeto vai para lá com o mesmo ID e o mesmo nome', pai('p1') === mes && nome('p1') === '227_FILME');
ok('--mover-para-mes: a _ASSETS do cliente não é tocada', pai('assets') === 'cli' && nome('assets') === '_ASSETS');
novo();
r = await rodar(['--executar'], 'Cliente Teste\n');
ok('sem --mover-para-mes: a pasta do projeto fica onde estava e PROJETOS não é criada', pai('p1') === 'cli' && !filhos('cli').some(f => f.name === 'PROJETOS'));

// ---------- 4b) projeto com sub-marca: Cliente › PROJETOS › Marca › AAAA-MM ----------
novo();
let lista = JSON.parse(fs.readFileSync(path.join(tmp, 'projetos.json'), 'utf8'));
lista[0].client_marcas = ['Uniasselvi', 'Vitru']; lista[0].marca = 'Uniasselvi';
fs.writeFileSync(path.join(tmp, 'projetos.json'), JSON.stringify(lista));
r = await rodar(['--executar', '--mover-para-mes'], 'Cliente Teste\n');
const pj = filhos('cli').find(f => f.name === 'PROJETOS')?.id;
const mr = filhos(pj ?? 'x').find(f => f.name === 'Uniasselvi')?.id;
const mm = filhos(mr ?? 'x').find(f => f.name === '2026-10')?.id;
ok('com sub-marca: Cliente/PROJETOS/Uniasselvi/2026-10 (a marca fica DENTRO de PROJETOS)', !!mm && pai('p1') === mm);

// ---------- 5) cliente com marcas e projeto sem marca: não move para o mês ----------
novo();
lista[0].marca = null;
fs.writeFileSync(path.join(tmp, 'projetos.json'), JSON.stringify(lista));
r = await rodar(['--executar', '--mover-para-mes'], 'Cliente Teste\n');
ok('cliente com marcas e projeto sem marca: reorganiza por dentro mas NÃO move a pasta', pai('p1') === 'cli' && /marca/i.test(r.out) && !filhos('cli').some(f => f.name === 'PROJETOS'));
lista[0].client_marcas = []; fs.writeFileSync(path.join(tmp, 'projetos.json'), JSON.stringify(lista));

// ---------- 6) --renomear-assets ----------
novo();
r = await rodar(['--renomear-assets']);
ok('simulação com --renomear-assets: mostra o plano e NÃO escreve nada', /RENOMEIA\s+_ASSETS/.test(r.out) && chamadas.every(c => c.startsWith('GET ')) && nome('assets') === '_ASSETS');
novo();
r = await rodar(['--executar'], 'Cliente Teste\n');
ok('sem --renomear-assets: _ASSETS continua _ASSETS (nunca é renomeada sozinha)', nome('assets') === '_ASSETS');
novo();
r = await rodar(['--executar', '--renomear-assets'], 'Cliente Teste\n');
ok('com --renomear-assets: a MESMA pasta vira MARCA (ID e conteúdo intactos)', nome('assets') === 'MARCA' && pai('assets') === 'cli' && pai('logos') === 'assets');
ok('com --renomear-assets: os projetos também foram migrados', pai('rev') !== 'ent' && nome('apr') === '02_FINAL');
ok('com --renomear-assets: nenhuma pasta nova MARCA/_ASSETS foi criada', filhos('cli').filter(f => f.name === 'MARCA' || f.name === '_ASSETS').length === 1);
const feitos = fs.readdirSync(path.join(tmp, 'saida')).filter(f => f.startsWith('feito-')).map(f => JSON.parse(fs.readFileSync(path.join(tmp, 'saida', f), 'utf8'))).flat();
ok('registro do que foi feito inclui a renomeação (nome antigo e novo, para desfazer)', feitos.some(x => x.feito?.some(y => y.op === 'renomeada' && y.nomeAntigo === '_ASSETS' && y.nomeNovo === 'MARCA' && y.id === 'assets')));
novo(); add('marca-ja', 'MARCA', 'cli');
r = await rodar(['--executar', '--renomear-assets'], 'Cliente Teste\n');
ok('MARCA e _ASSETS já coexistem: conflito, nada renomeado, projetos seguem', nome('assets') === '_ASSETS' && /CONFLITO/.test(r.out) && nome('apr') === '02_FINAL');

servidor.close();
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo');
process.exit(falhas ? 1 : 0);
