// Testa a regra "nunca subir/registrar em pasta na lixeira" (supabase/functions/*/pasta.mjs), sem rede.
// Rodar:  node scripts/testes-drive/pasta-revisao.test.mjs
import fs from 'node:fs';
import { ERRO_PASTA_LIXEIRA, ERRO_SEM_PASTA, camposParaGravar, resolverPastaRevisao } from '../../supabase/functions/drive-upload/pasta.mjs';

let falhas = 0;
const ok = (nome, cond) => { console.log((cond ? 'OK     ' : 'FALHA  ') + nome); if (!cond) falhas++; };

// Drive de mentira: `vivas` = ids de pasta viva; `filhos` = "paiId|nome" -> id (só pastas vivas).
const drive = (vivas, filhos = {}) => ({
  estaViva: async id => vivas.includes(id),
  achar: async (pai, nome) => filhos[`${pai}|${nome}`] ?? null,
});
const base = { drive_folder_id: 'RAIZ' };

// 1) Pasta viva: nada muda.
{
  const r = await resolverPastaRevisao({ proj: { ...base, drive_layout: 'v1', drive_upload_folder_id: 'REV' }, drive: drive(['REV']) });
  ok('v1 pasta viva: usa o ID salvo', r.ok && r.folderId === 'REV');
  ok('v1 pasta viva: não pede para gravar nada', r.mudou === false && !r.gravar);
  const r2 = await resolverPastaRevisao({ proj: { ...base, drive_layout: 'v2', drive_pastas: { revisao: 'REV2' }, drive_upload_folder_id: 'REV2' }, drive: drive(['REV2']) });
  ok('v2 pasta viva: usa drive_pastas.revisao', r2.ok && r2.folderId === 'REV2' && r2.mudou === false);
}

// 2) ID na lixeira, mas o caminho vivo existe: acha e atualiza o ID.
{
  const filhos = { 'RAIZ|06_ENTREGA': 'ENT_NOVA', 'ENT_NOVA|01_REVISAO': 'REV_NOVA' };
  const r = await resolverPastaRevisao({ proj: { ...base, drive_layout: 'v1', drive_upload_folder_id: 'REV_LIXO' }, drive: drive(['REV_NOVA'], filhos) });
  ok('v1 ID na lixeira + caminho vivo: acha a pasta viva', r.ok && r.folderId === 'REV_NOVA' && r.mudou === true);
  ok('v1: manda gravar o novo drive_upload_folder_id', r.gravar?.drive_upload_folder_id === 'REV_NOVA' && r.trocouDe === 'REV_LIXO');

  const f2 = { 'RAIZ|03_Export': 'EXP', 'EXP|01_Revisao': 'REV2_NOVA' };
  const proj2 = { ...base, drive_layout: 'v2', drive_upload_folder_id: 'R_VELHA', drive_pastas: { revisao: 'R_VELHA', bruto: 'B' } };
  const r2 = await resolverPastaRevisao({ proj: proj2, drive: drive(['REV2_NOVA'], f2) });
  ok('v2 ID na lixeira + 03_Export/01_Revisao vivo: acha', r2.ok && r2.folderId === 'REV2_NOVA');
  ok('v2: atualiza drive_pastas.revisao sem perder as outras chaves', r2.gravar?.drive_pastas?.revisao === 'REV2_NOVA' && r2.gravar?.drive_pastas?.bruto === 'B' && r2.gravar?.drive_upload_folder_id === 'REV2_NOVA');

  // pastas com o nome ANTIGO em caixa alta (criadas antes de 16/11): também são achadas
  const f3 = { 'RAIZ|03_EXPORT': 'EXP_VELHA', 'EXP_VELHA|01_REVISAO': 'REV3_NOVA' };
  const r3 = await resolverPastaRevisao({ proj: proj2, drive: drive(['REV3_NOVA'], f3) });
  ok('v2 ID na lixeira + 03_EXPORT/01_REVISAO (nome antigo em caixa alta) vivo: acha', r3.ok && r3.folderId === 'REV3_NOVA' && r3.mudou === true);
  // o nome novo tem prioridade quando as duas existem
  const f4 = { 'RAIZ|03_Export': 'EXP_N', 'EXP_N|01_Revisao': 'REV_N', 'RAIZ|03_EXPORT': 'EXP_V', 'EXP_V|01_REVISAO': 'REV_V' };
  const r4 = await resolverPastaRevisao({ proj: proj2, drive: drive(['REV_N', 'REV_V'], f4) });
  ok('v2: nome novo tem prioridade sobre o antigo', r4.ok && r4.folderId === 'REV_N');
}

// 3) Lixeira sem substituta: erro claro, nenhum ID para subir.
{
  const r = await resolverPastaRevisao({ proj: { ...base, drive_layout: 'v1', drive_upload_folder_id: 'REV_LIXO' }, drive: drive([]) });
  ok('v1 lixeira sem substituta: erro, sem pasta', !r.ok && r.codigo === ERRO_PASTA_LIXEIRA && !r.folderId);
  ok('erro tem mensagem para a pessoa ler', /lixeira/i.test(r.mensagem) && /Nada foi enviado/.test(r.mensagem));
  const r2 = await resolverPastaRevisao({ proj: { ...base, drive_layout: 'v2', drive_pastas: { revisao: 'X' } }, drive: drive([]) });
  ok('v2 lixeira sem substituta: erro', !r2.ok && r2.codigo === ERRO_PASTA_LIXEIRA);
  // só o 06_ENTREGA vivo, sem 01_REVISAO dentro: também é erro (não inventa pasta)
  const r3 = await resolverPastaRevisao({ proj: { ...base, drive_layout: 'v1', drive_upload_folder_id: 'REV_LIXO' }, drive: drive([], { 'RAIZ|06_ENTREGA': 'ENT' }) });
  ok('v1: 06_ENTREGA viva mas sem 01_REVISAO viva: erro', !r3.ok && r3.codigo === ERRO_PASTA_LIXEIRA);
}

// 4) Sem ID salvo (o scan antigo fazia "continue" calado): v1 procura por nome; v2 nunca procura por nome.
{
  const filhos = { 'RAIZ|06_ENTREGA': 'ENT', 'ENT|01_REVISAO': 'REV' };
  const r = await resolverPastaRevisao({ proj: { ...base, drive_layout: 'v1' }, drive: drive(['REV'], filhos) });
  ok('v1 sem ID salvo: acha pelo nome e manda gravar', r.ok && r.folderId === 'REV' && r.gravar?.drive_upload_folder_id === 'REV');
  const r2 = await resolverPastaRevisao({ proj: { ...base, drive_layout: 'v2' }, drive: drive(['REV'], { 'RAIZ|03_Export': 'EXP', 'EXP|01_Revisao': 'REV' }) });
  ok('v2 sem ID salvo: não procura por nome (erro "sem pasta")', !r2.ok && r2.codigo === ERRO_SEM_PASTA);
  const r3 = await resolverPastaRevisao({ proj: { ...base, drive_layout: 'v1' }, drive: drive([]) });
  ok('v1 sem ID e sem pasta: erro "sem pasta" (não diz lixeira)', !r3.ok && r3.codigo === ERRO_SEM_PASTA);
}

// 5) camposParaGravar e as duas cópias do módulo.
ok('camposParaGravar v1', JSON.stringify(camposParaGravar({ drive_layout: 'v1' }, 'Z')) === JSON.stringify({ drive_upload_folder_id: 'Z' }));
ok('as cópias de pasta.mjs (drive-upload e drive-watch) são idênticas',
  fs.readFileSync('supabase/functions/drive-upload/pasta.mjs', 'utf8') === fs.readFileSync('supabase/functions/drive-watch/pasta.mjs', 'utf8'));

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
