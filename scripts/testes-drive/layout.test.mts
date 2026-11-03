// Rodar:  node --experimental-strip-types scripts/testes-drive/layout.test.mts
import { ARVORE_V2, NOMES_V2, PASTA_MARCA, PASTA_MARCA_ANTIGA, PASTA_PROJETOS, SUBPASTAS_MARCA, aguardandoMarca, caminhoDoMes, layoutDoProjeto, mesDoProjeto, nomeDeContainer, pastasV2Completas } from '../../supabase/functions/drive-provision/layout.ts'

let falhas = 0
const ok = (nome: string, cond: boolean) => { console.log((cond ? 'OK     ' : 'FALHA  ') + nome); if (!cond) falhas++ }

// mês
ok('data_inicio tem prioridade (data pura não vira mês anterior)', mesDoProjeto('2026-11-01', '2026-10-15T12:00:00Z') === '2026-11')
ok('sem data_inicio usa created_at', mesDoProjeto(null, '2026-10-15T12:00:00Z') === '2026-10')
ok('created_at 01/11 01:00 UTC = 31/10 22:00 em São Paulo → 2026-10', mesDoProjeto(null, '2026-11-01T01:00:00Z') === '2026-10')
ok('created_at 01/11 04:00 UTC = 01/11 01:00 em São Paulo → 2026-11', mesDoProjeto(null, '2026-11-01T04:00:00Z') === '2026-11')
ok('data_inicio vazia ("") cai em created_at', mesDoProjeto('', '2026-03-10T15:00:00Z') === '2026-03')
let erro = false
try { mesDoProjeto(null, null) } catch { erro = true }
ok('sem nenhuma data → erro (não inventa mês)', erro)

// layout
const base = { isLive: false, driveFolderId: null, driveLayout: 'v1', temColunasV2: true }
ok('projeto novo digital → v2', layoutDoProjeto(base) === 'v2')
ok('projeto novo live → v1', layoutDoProjeto({ ...base, isLive: true }) === 'v1')
ok('projeto antigo com pasta → v1 (não converte sozinho)', layoutDoProjeto({ ...base, driveFolderId: 'abc' }) === 'v1')
ok('projeto v2 com pasta → v2', layoutDoProjeto({ ...base, driveFolderId: 'abc', driveLayout: 'v2' }) === 'v2')
ok('projeto v2 que é live (migrado) segue v2', layoutDoProjeto({ ...base, isLive: true, driveFolderId: 'abc', driveLayout: 'v2' }) === 'v2')
ok('banco sem as colunas novas → v1 (deploy fora de ordem não quebra)', layoutDoProjeto({ ...base, temColunasV2: false }) === 'v1')

// marca
ok('cliente com marcas e projeto sem marca → espera', aguardandoMarca(['A', 'B'], null) === true)
ok('cliente com marcas e marca em branco → espera', aguardandoMarca(['A'], '  ') === true)
ok('cliente com marcas e projeto com marca → segue', aguardandoMarca(['A'], 'A') === false)
ok('cliente sem marcas → segue sempre', aguardandoMarca([], null) === false && aguardandoMarca(null, null) === false)
ok('nome de marca: barra e espaços', nomeDeContainer('  Uni/asselvi   Ead ') === 'Uni-asselvi Ead')


// caminho até o mês: PROJETOS › [sub-marca] › AAAA-MM
ok('caminho sem marca: PROJETOS/AAAA-MM', caminhoDoMes(null, '2026-10').join('/') === 'PROJETOS/2026-10' && caminhoDoMes('  ', '2026-10').join('/') === 'PROJETOS/2026-10')
ok('caminho com sub-marca: PROJETOS/Marca/AAAA-MM (a marca fica dentro de PROJETOS)', caminhoDoMes('Uniasselvi', '2026-10').join('/') === 'PROJETOS/Uniasselvi/2026-10')
ok('caminho: barra na marca não cria nível extra', caminhoDoMes('A/B', '2026-10').join('/') === 'PROJETOS/A-B/2026-10')
ok('nomes da pasta do cliente', PASTA_MARCA === 'MARCA' && PASTA_MARCA_ANTIGA === '_ASSETS' && PASTA_PROJETOS === 'PROJETOS')
ok('MARCA nova: as 5 subpastas de antes + GUIDELINES', ['BRAND-BOOK', 'FONTES', 'GRAFICOS', 'IMAGENS', 'LOGOS', 'GUIDELINES'].every(n => SUBPASTAS_MARCA.includes(n)) && SUBPASTAS_MARCA.length === 6)

// árvore
const vistos = new Set<string>()
let paiAntesDoFilho = true
for (const n of ARVORE_V2) { if (n.pai && !vistos.has(n.pai)) paiAntesDoFilho = false; vistos.add(n.chave) }
ok('árvore: pai sempre antes do filho', paiAntesDoFilho)
ok('árvore: cobre todas as 7 pastas', vistos.size === 7 && Object.keys(NOMES_V2).every(k => vistos.has(k)))
ok('nomes finais', NOMES_V2.revisao === '01_REVISAO' && NOMES_V2.final === '02_FINAL' && NOMES_V2.export === '03_EXPORT')
const completo = Object.fromEntries(Object.keys(NOMES_V2).map(k => [k, 'id-' + k]))
ok('drive_pastas completo', pastasV2Completas(completo))
ok('drive_pastas faltando uma', !pastasV2Completas({ ...completo, final: '' }) && !pastasV2Completas(null) && !pastasV2Completas({}))

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo')
process.exit(falhas ? 1 : 0)
