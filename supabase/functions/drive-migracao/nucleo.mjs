// Núcleo da migração do Drive (v1 → v2): monta o plano de um cliente, escreve o relatório e aplica os passos.
// Não conhece Supabase nem HTTP: recebe o Drive (drive.mjs) e, ao executar, um `aoMigrar` que grava o projeto no banco.
// É usado pela edge function drive-migracao e pelo script scripts/drive-migracao/migrar-projetos-v2.mjs.

import { CAMINHOS, NOMES, caminhoDoMes, mesDoProjeto, planejarMarcaDoCliente, planejarProjeto } from './plano.mjs';

const norm = s => String(s ?? '').trim().toLowerCase();

/** Projetos do cliente (e, se pedido, um só). `projeto` aceita o id ou o código. */
export function filtrarProjetos(todos, cliente, projeto) {
  let alvos = todos.filter(p => norm(p.client_name) === norm(cliente));
  if (projeto) alvos = alvos.filter(p => p.id === projeto || norm(p.code) === norm(projeto));
  return alvos;
}

export const motivoParaPular = p =>
  p.layout === 'v2' ? 'já é v2'
    : (p.category || '').toLowerCase() === 'live' ? 'live: segue no template de live (v1)'
      : !p.drive_folder_id ? 'sem pasta no Drive'
        : null;

const rotuloDestino = s => CAMINHOS[s.para] ?? s.para;
const rotuloOrigem = s => (!s.de || s.de === 'raiz' ? 'a pasta do projeto' : s.de);
const amostra = (nomes, n = 8) => (nomes.length > n ? `${nomes.slice(0, n).join(', ')} … (+${nomes.length - n})` : nomes.join(', '));

export function descreverProjeto(p, plano) {
  const L = [`### ${p.code ?? ''} ${p.name}  (${p.status}, id ${p.id})`];
  for (const s of plano.passos) {
    if (s.op === 'reusar') L.push(`- REAPROVEITA  ${s.nome}  [${s.id}]  → vira ${CAMINHOS[s.chave]}`);
    if (s.op === 'criar') L.push(`- CRIA         ${s.nome}  dentro de ${s.pai === 'raiz' ? 'a pasta do projeto' : NOMES[s.pai]}`);
    if (s.op === 'mover') {
      L.push(`- MOVE         ${s.nome}  [${s.id}]  (${s.tipo})  de ${rotuloOrigem(s)} → ${rotuloDestino(s)}${s.renomearPara ? `   (renomeia para ${s.renomearPara})` : ''}`);
      if (s.nota) L.push(`                 ${s.nota}; conteúdo: ${s.conteudo?.length ? amostra(s.conteudo) : '—'}`);
    }
    if (s.op === 'lixeira') L.push(`- LIXEIRA      ${s.nome}  [${s.id}]  em ${rotuloOrigem(s)}: ${s.motivo}  (só vai se estiver vazia na hora; é lixeira, não exclusão)`);
    if (s.op === 'conflito') L.push(`- CONFLITO     ${s.nome}  [${s.id}]  ${s.motivo}: NÃO será movido nem sobrescrito`);
  }
  for (const i of plano.ignorados) L.push(`- fica         ${i.nome}  (${i.motivo})`);
  if (plano.sobraEmEntrega.length) L.push(`- 06_ENTREGA continua com: ${plano.sobraEmEntrega.map(x => x.nome).join(', ')}`);
  for (const a of plano.avisos) L.push(`- ATENÇÃO      ${a}`);
  return L;
}

/** Linha do relatório para o passo de "mover a pasta do projeto para o mês" (opção mover_para_mes). */
async function moverParaMes(drive, p, executar) {
  const mes = mesDoProjeto(p.data_inicio, p.created_at);
  if ((p.client_marcas || []).length && !String(p.marca ?? '').trim()) return { aviso: `cliente tem marcas e o projeto não tem marca: não movo para ${mes} (decida a marca antes)` };
  if (!p.client_drive_folder_id) return { aviso: 'cliente sem pasta registrada: não movo para a pasta do mês' };
  const caminho = caminhoDoMes(p.marca, mes);
  if (!executar) return { texto: `- MOVE         a pasta do projeto → ${p.client_name}/${caminho.join('/')}/  (opção mover_para_mes)` };
  // Cliente › PROJETOS › [sub-marca] › AAAA-MM: contêineres achados pelo nome e criados se faltarem.
  let paiId = p.client_drive_folder_id;
  for (const nome of caminho) {
    const achada = (await drive.listar(paiId)).find(f => f.isFolder && f.name === nome);
    paiId = achada ? achada.id : await drive.criarPasta(paiId, nome);
  }
  const r = await drive.mover(p.drive_folder_id, paiId);
  return { feito: { op: 'movida', id: p.drive_folder_id, nomeAntigo: r.nomeAntigo, nomeNovo: r.nomeAntigo, paisAntigos: r.paisAntigos, paiNovo: paiId } };
}

/**
 * Monta o plano de todos os projetos do cliente. SÓ LÊ o Drive.
 * @param {object} o
 * @param {ReturnType<import('./drive.mjs').criarDrive>} o.drive
 * @param {string} o.cliente
 * @param {object[]} o.projetos projetos do cliente (formato da consulta B de scripts/drive-migracao/consultas.sql)
 * @param {{moverParaMes?:boolean, renomearAssets?:boolean, entregaVaziaParaLixeira?:boolean}} [o.opcoes]
 */
export async function planejarCliente({ drive, cliente, projetos, opcoes = {} }) {
  const R = [];
  let planoMarca = null;
  if (opcoes.renomearAssets) {
    const clienteDriveId = projetos.find(p => p.client_drive_folder_id)?.client_drive_folder_id;
    if (!clienteDriveId) R.push('### Pasta de materiais fixos → pulada: cliente sem pasta registrada', '');
    else {
      planoMarca = planejarMarcaDoCliente(await drive.listar(clienteDriveId));
      const linha = {
        renomear: `- RENOMEIA     _ASSETS  [${planoMarca.id}]  → MARCA   (mesma pasta, mesmo ID)`,
        conflito: `- CONFLITO     ${planoMarca.motivo}`,
        'ja-esta': '- já está como MARCA; nada a fazer',
        nada: `- ${planoMarca.motivo}`,
      }[planoMarca.acao];
      R.push('### Pasta de materiais fixos do cliente (renomear_assets)', linha, '');
    }
  }

  const itens = [];
  const pulados = [];
  for (const p of projetos) {
    const motivo = motivoParaPular(p);
    if (motivo) { R.push(`### ${p.code ?? ''} ${p.name}  → pulado: ${motivo}`, ''); pulados.push({ id: p.id, code: p.code, nome: p.name, motivo }); continue; }
    const plano = await planejarProjeto({ raizId: p.drive_folder_id, listar: drive.listar, opcoes });
    const linhas = descreverProjeto(p, plano);
    if (opcoes.moverParaMes) {
      const m = await moverParaMes(drive, p, false);
      if (m.texto) linhas.push(m.texto);
      if (m.aviso) linhas.push(`- ATENÇÃO      ${m.aviso}`);
    }
    R.push(...linhas, '');
    itens.push({ p, plano });
  }

  const resumo = { projetos: itens.length, criar: 0, mover: 0, pastas: 0, arquivos: 0, lixeira: 0, reusar: 0, conflito: 0 };
  for (const { plano } of itens) {
    for (const s of plano.passos) {
      resumo[s.op] = (resumo[s.op] || 0) + 1;
      if (s.op === 'mover') resumo[s.tipo === 'arquivo' ? 'arquivos' : 'pastas']++;
    }
  }
  R.push(`## Resumo: ${resumo.projetos} projeto(s) a migrar — ${resumo.criar} criação(ões), ${resumo.mover} movimento(s) (${resumo.pastas} pasta(s), ${resumo.arquivos} arquivo(s)), ${resumo.lixeira} para a lixeira, ${resumo.reusar} reaproveitamento(s), ${resumo.conflito} conflito(s)`);
  return { texto: R.join('\n'), itens, pulados, planoMarca, resumo };
}

/** Aplica os passos de UM projeto. A lixeira só acontece se a pasta estiver vazia nesta hora. */
async function aplicar(drive, p, plano) {
  const ctx = { raiz: p.drive_folder_id };
  const feito = [];
  for (const s of plano.passos) {
    if (s.op === 'reusar') ctx[s.chave] = s.id;
    else if (s.op === 'criar') {
      ctx[s.chave] = await drive.criarPasta(ctx[s.pai], s.nome);
      feito.push({ op: 'criada', id: ctx[s.chave], nome: s.nome });
    } else if (s.op === 'mover') {
      const r = await drive.mover(s.id, ctx[s.para], s.renomearPara);
      if (s.registra) ctx[s.registra] = s.id;
      feito.push({ op: 'movida', id: s.id, nomeAntigo: r.nomeAntigo, nomeNovo: s.renomearPara ?? r.nomeAntigo, paisAntigos: r.paisAntigos, paiNovo: ctx[s.para] });
    } else if (s.op === 'lixeira') {
      const restam = await drive.listar(s.id);
      if (restam.length) feito.push({ op: 'lixeira-pulada', id: s.id, nome: s.nome, motivo: `ainda tem ${restam.length} item(ns): ${amostra(restam.map(x => x.name), 5)}` });
      else { await drive.paraLixeira(s.id); feito.push({ op: 'lixeira', id: s.id, nome: s.nome }); }
    }
  }
  return { ctx, feito };
}

/**
 * Aplica o plano (de planejarCliente). Para no primeiro erro; o que já foi feito fica registrado.
 * `aoMigrar(p, pastas)` grava o projeto como v2 no banco logo depois do Drive, antes de seguir para o próximo.
 */
export async function executarPlanos({ drive, plano, opcoes = {}, aoMigrar, orcamentoMs = 100_000 }) {
  const inicio = Date.now();
  const res = { projetos: [], renomeouMarca: null, vazias: [], avisos: [], erro: null, naoProcessados: [] };

  if (plano.planoMarca?.acao === 'renomear') {
    try {
      await drive.renomear(plano.planoMarca.id, plano.planoMarca.para);
      res.renomeouMarca = { id: plano.planoMarca.id, de: plano.planoMarca.de, para: plano.planoMarca.para };
    } catch (e) { res.erro = `não consegui renomear _ASSETS: ${e.message}. Nada foi feito nos projetos.`; return res; }
  }

  for (let i = 0; i < plano.itens.length; i++) {
    const { p, plano: pl } = plano.itens[i];
    if (Date.now() - inicio > orcamentoMs) { res.naoProcessados = plano.itens.slice(i).map(x => ({ id: x.p.id, code: x.p.code, nome: x.p.name })); break; }
    const reg = { id: p.id, code: p.code, nome: p.name, feito: [], persistido: false };
    res.projetos.push(reg);
    try {
      const { ctx, feito } = await aplicar(drive, p, pl);
      reg.feito = feito;
      if (opcoes.moverParaMes) {
        const m = await moverParaMes(drive, p, true);
        if (m.feito) feito.push(m.feito);
        if (m.aviso) res.avisos.push(`${p.code ?? ''} ${p.name}: ${m.aviso}`);
      }
      const pastas = Object.fromEntries(Object.keys(NOMES).map(k => [k, ctx[k]]));
      reg.pastas = pastas;
      if (aoMigrar) { await aoMigrar(p, pastas); reg.persistido = true; }
      for (const f of feito) if (f.op === 'lixeira-pulada') res.avisos.push(`${p.code ?? ''} ${p.name}: ${f.nome} não foi para a lixeira (${f.motivo})`);
      if (pl.entregaId && (await drive.listar(pl.entregaId)).length === 0 && !feito.some(f => f.op === 'lixeira' && f.id === pl.entregaId)) {
        res.vazias.push(`${p.code ?? ''} ${p.name} → 06_ENTREGA [${pl.entregaId}]`);
      }
    } catch (e) {
      reg.erro = e.message; res.erro = `${p.code ?? ''} ${p.name}: ${e.message}`;
      break;
    }
  }
  return res;
}
