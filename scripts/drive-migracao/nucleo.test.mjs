// Testa o núcleo (supabase/functions/drive-migracao/nucleo.mjs) e o cliente do Drive (drive.mjs) sem rede.
// Rodar:  node scripts/drive-migracao/nucleo.test.mjs
import crypto from 'node:crypto';
import { criarDrive } from '../../supabase/functions/drive-migracao/drive.mjs';
import { executarPlanos, planejarCliente } from '../../supabase/functions/drive-migracao/nucleo.mjs';

let falhas = 0;
const ok = (nome, cond) => { console.log((cond ? 'OK     ' : 'FALHA  ') + nome); if (!cond) falhas++; };

// ---- Drive em memória com a mesma interface do drive.mjs
function memoria() {
  const nos = new Map(); let seq = 0; const escritas = [];
  const api = {
    nos, escritas,
    add: (id, name, pai, pasta = true) => { nos.set(id, { id, name, pai, isFolder: pasta, lixo: false }); return api; },
    listar: async pai => [...nos.values()].filter(n => n.pai === pai && !n.lixo).map(({ id, name, isFolder }) => ({ id, name, isFolder })),
    criarPasta: async (pai, nome) => { const id = 'novo' + ++seq; nos.set(id, { id, name: nome, pai, isFolder: true, lixo: false }); escritas.push(`criar ${nome}`); return id; },
    mover: async (id, pai, nome) => { const n = nos.get(id); const r = { paisAntigos: [n.pai], nomeAntigo: n.name }; n.pai = pai; if (nome) n.name = nome; escritas.push(`mover ${id}`); return r; },
    renomear: async (id, nome) => { nos.get(id).name = nome; escritas.push(`renomear ${id}`); },
    paraLixeira: async id => { nos.get(id).lixo = true; escritas.push(`lixeira ${id}`); },
  };
  return api;
}
const proj = (id, raiz, extra = {}) => ({ id: 'u-' + id, code: id, name: 'PROJ ' + id, status: 'ativo', category: 'digital', layout: 'v1', marca: null, data_inicio: null, created_at: '2026-10-15T12:00:00Z', drive_folder_id: raiz, client_name: 'Cli', client_drive_folder_id: 'cli', client_marcas: [], ...extra });
function cenario() {
  const d = memoria();
  d.add('cli', 'Cli', null);
  for (const n of ['A', 'B']) {
    d.add('P' + n, '2' + n, 'cli').add('e' + n, '06_ENTREGA', 'P' + n).add('apr' + n, '02_APROVADO', 'e' + n).add('rd' + n, '03_REDES', 'e' + n).add('reels' + n, 'reels.mp4', 'rd' + n, false);
  }
  return d;
}

// ---- lixeira só se estiver vazia NA HORA de aplicar
{
  const d = cenario();
  const plano = await planejarCliente({ drive: d, cliente: 'Cli', projetos: [proj('A', 'PA')] });
  ok('plano prevê a lixeira da REDES (hoje só tem 1 arquivo, que sai)', plano.itens[0].plano.passos.some(s => s.op === 'lixeira' && s.id === 'rdA'));
  d.add('intruso', 'novo-upload.mp4', 'rdA', false); // alguém põe um arquivo na REDES depois do plano
  const res = await executarPlanos({ drive: d, plano, aoMigrar: async () => {} });
  ok('REDES não foi para a lixeira porque deixou de estar vazia', d.nos.get('rdA').lixo === false && d.nos.get('intruso').pai === 'rdA');
  ok('o arquivo que estava no plano foi movido normalmente', d.nos.get('reelsA').pai === 'aprA');
  ok('o resultado avisa que a pasta não foi apagada e por quê', res.avisos.some(a => /03_REDES/.test(a) && /novo-upload\.mp4/.test(a)) && res.projetos[0].feito.some(f => f.op === 'lixeira-pulada'));
  ok('e mesmo assim o projeto é gravado como v2 (a pasta que sobrou é só um aviso)', res.projetos[0].persistido === true && !res.erro);
}

// ---- aoMigrar recebe os 7 IDs; erro para na hora e não segue para o próximo projeto
{
  const d = cenario();
  const plano = await planejarCliente({ drive: d, cliente: 'Cli', projetos: [proj('A', 'PA'), proj('B', 'PB')] });
  const gravados = [];
  const res = await executarPlanos({ drive: d, plano, aoMigrar: async (p, pastas) => { gravados.push([p.id, pastas]); if (p.id === 'u-A') throw new Error('banco fora do ar'); } });
  ok('aoMigrar recebe os 7 IDs (documentos, bruto, artes, trilhas, export, revisao, final)', Object.keys(gravados[0][1]).sort().join() === 'artes,bruto,documentos,export,final,revisao,trilhas' && Object.values(gravados[0][1]).every(Boolean));
  ok('erro ao gravar no banco: execução para, o projeto seguinte NÃO é tocado', res.erro && /banco fora do ar/.test(res.erro) && gravados.length === 1 && d.nos.get('reelsB').pai === 'rdB' && res.projetos.length === 1 && res.projetos[0].persistido === false);
}

// ---- orçamento de tempo: não começa projeto novo depois do limite
{
  const d = cenario();
  const plano = await planejarCliente({ drive: d, cliente: 'Cli', projetos: [proj('A', 'PA'), proj('B', 'PB')] });
  const res = await executarPlanos({ drive: d, plano, orcamentoMs: -1, aoMigrar: async () => {} });
  ok('sem tempo: nenhum projeto é iniciado e todos aparecem como não processados', d.escritas.length === 0 && res.naoProcessados.length === 2 && !res.erro);
}

// ---- projetos live e já v2 são pulados e aparecem no plano
{
  const d = cenario();
  const plano = await planejarCliente({ drive: d, cliente: 'Cli', projetos: [proj('A', 'PA', { category: 'live' }), proj('B', 'PB', { layout: 'v2' })] });
  ok('live e v2: pulados, com motivo, sem plano', plano.itens.length === 0 && plano.pulados.length === 2 && /pulado: live/.test(plano.texto) && /pulado: já é v2/.test(plano.texto));
}

// ---- planejar nunca escreve (qualquer projeto, com as opções ligadas)
{
  const d = cenario();
  await planejarCliente({ drive: d, cliente: 'Cli', projetos: [proj('A', 'PA'), proj('B', 'PB')], opcoes: { moverParaMes: true, renomearAssets: true, entregaVaziaParaLixeira: true } });
  ok('planejarCliente não faz NENHUMA escrita, nem com todas as opções ligadas', d.escritas.length === 0);
}

// ---- cliente do Drive em modo somente leitura: bloqueia escrita antes de sair do processo
{
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sa = { client_email: 't@x.iam', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const original = globalThis.fetch; const chamadas = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url); const metodo = (init.method || 'GET').toUpperCase(); chamadas.push(`${metodo} ${u.hostname}${u.pathname}`);
    if (u.hostname === 'oauth2.googleapis.com') return new Response(JSON.stringify({ access_token: 't' }));
    if (/\/files\/x$/.test(u.pathname)) return new Response(JSON.stringify({ parents: ['p'], name: 'x' }));
    return new Response(JSON.stringify({ files: [{ id: '1', name: 'a', mimeType: 'application/vnd.google-apps.folder' }] }));
  };
  try {
    const leitura = criarDrive({ sa, driveId: 'D', somenteLeitura: true });
    const lista = await leitura.listar('p');
    ok('somente leitura: listar funciona', lista.length === 1 && lista[0].isFolder === true);
    for (const [nome, f] of [['criarPasta', () => leitura.criarPasta('p', 'n')], ['mover', () => leitura.mover('x', 'q')], ['renomear', () => leitura.renomear('x', 'n')], ['paraLixeira', () => leitura.paraLixeira('x')]]) {
      const antes = chamadas.length; let erro = null; try { await f(); } catch (e) { erro = e.message; }
      ok(`somente leitura: ${nome} é recusada`, /somente leitura/.test(erro ?? '') && chamadas.slice(antes).every(c => c.startsWith('GET ') || c.startsWith('POST oauth2')));
    }
    ok('somente leitura: nenhuma escrita chegou ao Drive', chamadas.every(c => c.startsWith('GET ') || c.startsWith('POST oauth2')));
    const escrita = criarDrive({ sa, driveId: 'D' });
    await escrita.paraLixeira('x');
    ok('com escrita liberada, paraLixeira manda PATCH trashed (nunca DELETE)', chamadas.some(c => c.startsWith('PATCH ')) && !chamadas.some(c => c.startsWith('DELETE ')));
    let semConta = null; try { criarDrive({ sa: {}, driveId: 'D' }); } catch (e) { semConta = e.message; }
    ok('conta de serviço ausente: erro claro, sem citar conteúdo', /ausente ou inválida/.test(semConta ?? ''));
  } finally { globalThis.fetch = original; }
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo');
process.exit(falhas ? 1 : 0);
