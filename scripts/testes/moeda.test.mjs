// Rodar: node --test scripts/testes/moeda.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPREAD_PADRAO, calcCotacaoTravada, converterValor, formatarMoeda,
  formatarValorDaVersao, moedaDaVersao, taxaDaVersao, camposDeMoeda, diasDesde,
  usdDoTitulo, parseValorBR,
} from '../../src/utils/moeda.ts';

const semNbsp = (s) => s.replace(/ /g, ' ');
const usd = { currency: 'USD', fx_rate: 4.85 };

test('margem de segurança padrão é 3%', () => {
  assert.equal(SPREAD_PADRAO, 0.03);
});

test('cotação travada = mercado menos a margem, em 4 casas', () => {
  assert.equal(calcCotacaoTravada(5, 0.03), 4.85);
  assert.equal(calcCotacaoTravada(5.0119, 0.03), 4.8615);
  assert.equal(calcCotacaoTravada(5, 0), 5);
});

test('converte reais em dólar pela cotação travada', () => {
  assert.equal(converterValor(50000, usd), 10309.28);
  assert.equal(converterValor(2000, usd), 412.37);
  assert.equal(converterValor(50000, { currency: 'USD', fx_rate: '4.85' }), 10309.28);
});

test('em R$ o valor passa sem mudança', () => {
  assert.equal(converterValor(1234.5678, { currency: 'BRL', fx_rate: 4.85 }), 1234.5678);
  assert.equal(converterValor(1234.5678, undefined), 1234.5678);
});

test('USD sem cotação válida é tratado como R$', () => {
  assert.equal(moedaDaVersao({ currency: 'USD', fx_rate: null }), 'BRL');
  assert.equal(moedaDaVersao({ currency: 'USD', fx_rate: 0 }), 'BRL');
  assert.equal(taxaDaVersao({ currency: 'USD', fx_rate: -1 }), null);
  assert.equal(converterValor(100, { currency: 'USD', fx_rate: null }), 100);
});

test('formata em R$ e em US$', () => {
  assert.equal(semNbsp(formatarMoeda(1234.5, 'BRL')), 'R$ 1.234,50');
  assert.equal(semNbsp(formatarMoeda(10309.28, 'USD')), 'US$ 10.309,28');
  assert.equal(semNbsp(formatarValorDaVersao(50000, usd)), 'US$ 10.309,28');
  assert.equal(semNbsp(formatarValorDaVersao(50000, { currency: 'BRL' })), 'R$ 50.000,00');
});

test('campos de moeda para gravar', () => {
  assert.deepEqual(camposDeMoeda(undefined), {
    currency: 'BRL', fx_market_rate: null, fx_spread_pct: 0.03,
    fx_rate: null, fx_rate_at: null, fx_source: null,
  });
  assert.deepEqual(
    camposDeMoeda({ currency: 'USD', fx_market_rate: 5, fx_spread_pct: 0.03, fx_rate: 4.85, fx_rate_at: '2026-10-09T12:00:00Z', fx_source: 'ptax' }),
    { currency: 'USD', fx_market_rate: 5, fx_spread_pct: 0.03, fx_rate: 4.85, fx_rate_at: '2026-10-09T12:00:00Z', fx_source: 'ptax' },
  );
});

test('dias desde a cotação', () => {
  assert.equal(diasDesde('2026-10-01T00:00:00Z', new Date('2026-10-09T00:00:00Z')), 8);
  assert.equal(diasDesde(null), null);
  assert.equal(diasDesde('lixo'), null);
});

test('referência em US$ de um título: previsto em reais ÷ cotação travada', () => {
  assert.equal(usdDoTitulo({ total_amount: 5000 }, usd), 1030.93);
  // depois do recebimento, total_amount vira o valor real; o US$ continua o contratado (valor_previsto)
  assert.equal(usdDoTitulo({ total_amount: 5300, valor_previsto: 5000 }, usd), 1030.93);
  assert.equal(usdDoTitulo({ total_amount: '5000', valor_previsto: null }, usd), 1030.93);
});

test('título sem versão em dólar não tem referência em US$', () => {
  assert.equal(usdDoTitulo({ total_amount: 5000 }, { currency: 'BRL', fx_rate: 4.85 }), null);
  assert.equal(usdDoTitulo({ total_amount: 5000 }, null), null);
  assert.equal(usdDoTitulo({ total_amount: 5000 }, { currency: 'USD', fx_rate: null }), null);
  assert.equal(usdDoTitulo({ total_amount: null, valor_previsto: null }, usd), null);
});

test('lê valores em reais digitados à brasileira', () => {
  assert.equal(parseValorBR('51.200,50'), 51200.5);
  assert.equal(parseValorBR('51200,5'), 51200.5);
  assert.equal(parseValorBR('1,5'), 1.5);
  assert.equal(parseValorBR('R$ 51.200,00'), 51200);
  assert.equal(parseValorBR('R$\u00a051.200,00'), 51200); // NBSP
  assert.equal(parseValorBR('51.200'), 51200);     // ponto de milhar
  assert.equal(parseValorBR('1.234.567'), 1234567);
  assert.equal(parseValorBR('51200.5'), 51200.5);  // ponto decimal
  assert.equal(parseValorBR('1.5'), 1.5);
  assert.equal(parseValorBR('1000'), 1000);
  assert.equal(parseValorBR('1.000.000,25'), 1000000.25);
});

test('valor digitado inválido ou ambíguo vira null', () => {
  assert.equal(parseValorBR(''), null);
  assert.equal(parseValorBR('   '), null);
  assert.equal(parseValorBR('abc'), null);
  assert.equal(parseValorBR('0'), null);
  assert.equal(parseValorBR('-5'), null);
  assert.equal(parseValorBR('0,004'), null);     // arredonda para 0
  assert.equal(parseValorBR('1e3'), null);
  assert.equal(parseValorBR('0x10'), null);
  assert.equal(parseValorBR('51,200.50'), null); // formato americano
  assert.equal(parseValorBR('1,234.56'), null);
  assert.equal(parseValorBR('2,600'), null);     // 3 dígitos após a vírgula: ambíguo
  assert.equal(parseValorBR('1.234,5.6'), null);
  assert.equal(parseValorBR('1,5,5'), null);
  assert.equal(parseValorBR('1.2345'), null);
  assert.equal(parseValorBR('12.34.56'), null);
  assert.equal(parseValorBR('1234.567'), null);  // 4 dígitos antes do ponto: não é milhar válido nem decimal de 2 casas
});
