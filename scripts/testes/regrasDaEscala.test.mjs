// Rodar: node --test scripts/testes/regrasDaEscala.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chaveDoNome, compararFichaComEscala, temDiferenca, assinaturaDaDiferenca, aplicarEscalaNaFicha,
  conflitosPorPessoa, montarMensagemDaDiaria, linkDoMapa,
} from '../../src/lib/regrasDaEscala.ts';

const p = (nome, funcao = '') => ({ nome, funcao });
const tudo = { entram: true, funcoes: true, tirar: true };
const padrao = { entram: true, funcoes: true, tirar: false };

test('reconhece a pessoa sem ligar para acento, caixa e espaços', () => {
  assert.equal(chaveDoNome('  João   ARAÚJO '), chaveDoNome('joao araujo'));
});

test('ficha igual à escala não tem diferença', () => {
  const d = compararFichaComEscala([p('Ana', 'Direção'), p('Bruno')], [p('bruno'), p('ANA', 'direcao')]);
  assert.equal(temDiferenca(d), false);
});

test('aponta quem entra, quem mudou de função e quem está só na ficha', () => {
  const d = compararFichaComEscala(
    [p('Ana', 'Direção'), p('Cliente Convidado', 'Acompanha')],
    [p('Ana', 'Direção de arte'), p('Bruno', 'Câmera')],
  );
  assert.deepEqual(d.entram, [p('Bruno', 'Câmera')]);
  assert.deepEqual(d.funcoes, [{ nome: 'Ana', de: 'Direção', para: 'Direção de arte' }]);
  assert.deepEqual(d.soNaFicha, [p('Cliente Convidado', 'Acompanha')]);
});

test('escala sem função não apaga a função da ficha', () => {
  assert.equal(temDiferenca(compararFichaComEscala([p('Ana', 'Direção')], [p('Ana')])), false);
});

test('pessoa com duas linhas na ficha: se uma já tem a função, está igual; senão muda só a primeira', () => {
  const ficha = [p('Ana', 'Direção'), p('Ana', 'Câmera')];
  assert.equal(temDiferenca(compararFichaComEscala(ficha, [p('Ana', 'Câmera')])), false);
  const d = compararFichaComEscala(ficha, [p('Ana', 'Som')]);
  assert.deepEqual(aplicarEscalaNaFicha(ficha, d, padrao), [p('Ana', 'Som'), p('Ana', 'Câmera')]);
});

test('por padrão NÃO tira quem está só na ficha, e mantém ordem e campos extras', () => {
  const ficha = [{ ...p('Convidado'), telefone: '11' }, { ...p('Ana', 'Direção'), telefone: '22' }];
  const d = compararFichaComEscala(ficha, [p('Ana', 'Foto'), p('Bruno', 'Som')]);
  assert.deepEqual(aplicarEscalaNaFicha(ficha, d, padrao), [
    { nome: 'Convidado', funcao: '', telefone: '11' },
    { nome: 'Ana', funcao: 'Foto', telefone: '22' },
    p('Bruno', 'Som'),
  ]);
  assert.deepEqual(aplicarEscalaNaFicha(ficha, d, tudo).map(x => x.nome), ['Ana', 'Bruno']);
});

test('depois de aplicar tudo a ficha fica igual à escala', () => {
  const escala = [p('Ana', 'Foto'), p('Bruno', 'Som')];
  const ficha = [p('Zé'), p('Ana', 'Direção')];
  const nova = aplicarEscalaNaFicha(ficha, compararFichaComEscala(ficha, escala), tudo);
  assert.equal(temDiferenca(compararFichaComEscala(nova, escala)), false);
});

test('a assinatura da diferença ignora a ordem e muda quando a escala muda', () => {
  const a = compararFichaComEscala([], [p('Ana'), p('Bruno')]);
  const b = compararFichaComEscala([], [p('Bruno'), p('Ana')]);
  const c = compararFichaComEscala([], [p('Ana'), p('Bruno'), p('Carla')]);
  assert.equal(assinaturaDaDiferenca(a), assinaturaDaDiferenca(b));
  assert.notEqual(assinaturaDaDiferenca(a), assinaturaDaDiferenca(c));
});

test('conflito: outro projeto mostra o projeto; o mesmo projeto mostra a diária', () => {
  const outras = [
    { id: 'd2', nome: 'Diária 2', project_id: 'p1', projeto: 'Meu Projeto' },
    { id: 'd3', nome: 'Diária A', project_id: 'p9', projeto: 'Campanha X' },
  ];
  const m = conflitosPorPessoa(outras, [
    { diaria_id: 'd2', user_id: 'u1', freela_id: null },
    { diaria_id: 'd3', user_id: 'u1', freela_id: null },
    { diaria_id: 'd3', user_id: null, freela_id: 'f1' },
    { diaria_id: 'fora', user_id: 'u2', freela_id: null },
  ], 'p1');
  assert.deepEqual(m.get('user:u1'), ['Diária 2 (deste projeto)', 'Campanha X']);
  assert.deepEqual(m.get('freela:f1'), ['Campanha X']);
  assert.equal(m.has('user:u2'), false);
});

test('mensagem do WhatsApp completa', () => {
  const msg = montarMensagemDaDiaria({
    nome: 'Diária 1', projeto: 'Campanha X', data: '2026-11-27', horaInicio: '08:00:00', horaFim: '18:00:00',
    local: 'Estúdio Central', endereco: 'Rua A, 10, São Paulo',
    equipe: [p('Ana', 'Direção'), p('Bruno')],
  });
  assert.equal(msg, [
    '*Diária 1*', 'Campanha X', '',
    '*Data:* sexta-feira, 27 de novembro de 2026',
    '*Horário:* 08:00 às 18:00',
    '*Local:* Estúdio Central, Rua A, 10, São Paulo',
    `*Mapa:* ${linkDoMapa('Rua A, 10, São Paulo')}`,
    '', '*Equipe:*', '• Ana: Direção', '• Bruno',
  ].join('\n'));
});

test('mensagem com dados faltando e diária que vira a madrugada', () => {
  const vazia = montarMensagemDaDiaria({ nome: 'D', equipe: [] });
  assert.match(vazia, /\*Data:\* a definir/);
  assert.match(vazia, /\*Horário:\* a definir/);
  assert.match(vazia, /\*Local:\* a definir/);
  assert.doesNotMatch(vazia, /Mapa/);
  assert.match(vazia, /ainda não escalada/);
  assert.match(montarMensagemDaDiaria({ nome: 'D', horaInicio: '20:00', horaFim: '04:00', equipe: [] }), /20:00 às 04:00 \(dia seguinte\)/);
  assert.match(montarMensagemDaDiaria({ nome: 'D', horaInicio: '09:00', equipe: [] }), /a partir das 09:00/);
  assert.match(montarMensagemDaDiaria({ nome: 'D', local: 'Praia', equipe: [] }), /\*Mapa:\* https:\/\/www\.google\.com\/maps\/search\/Praia/);
});
