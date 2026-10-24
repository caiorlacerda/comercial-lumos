// Funções puras de data, hora e link. Movido de PortalCliente.tsx sem alterar.
import type { Gravacao } from './tipos';

/** WhatsApp aceita telefone escrito de qualquer jeito; o link precisa de dígitos. */
export const linkZap = (n: string) => {
  const so = n.replace(/\D/g, '');
  if (so.length < 10) return null;
  return `https://wa.me/${so.length <= 11 ? '55' + so : so}`;
};
/** Slack pode vir como link ou como @nome; só o link vira botão que abre algo. */
export const linkSlack = (s: string) => (/^https?:\/\//.test(s.trim()) ? s.trim() : null);

export const dia = (s?: string | null) =>
  s ? new Date(s.length <= 10 ? `${s}T12:00:00` : s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : null;

/** O mês de uma data 'AAAA-MM-DD' por extenso, pro aviso dizer de que mês está
 *  falando: o calendário vai a 90 dias, e quase toda data escolhida cai num mês
 *  que não é o de hoje. */
export const mesPorExtenso = (s: string) =>
  new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', { month: 'long' });

/** A data por extenso, pro título da janela de pedido: "Terça-feira, 3 de
 *  setembro de 2026". */
export const dataPorExtenso = (s: string) => {
  const t = new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** O horário da gravação em uma linha só. Sem hora marcada não inventa
 *  número: quem lê precisa saber que ainda não está definido. */
export const horario = (g: { hora_inicio: string | null; hora_fim: string | null }) => {
  const i = g.hora_inicio?.slice(0, 5);
  const f = g.hora_fim?.slice(0, 5);
  if (!i) return null;
  return f ? `${i} às ${f}` : `a partir das ${i}`;
};

/** O que a ordem do dia aprovada tem pro cliente, já limpo: ponto de encontro,
 *  cronograma e o recado dele. Devolve null quando não há nada pra mostrar, e
 *  a seção "No dia" some inteira. Antes da migração 2026093337 a chave `ordem`
 *  nem chega, e é exatamente o mesmo caminho. */
export const noDia = (g: Gravacao) => {
  const o = g.ordem;
  if (!o) return null;
  const nome = o.ponto_encontro?.nome?.trim() || '';
  const endereco = o.ponto_encontro?.endereco?.trim() || '';
  const ponto = nome || endereco ? { nome, endereco } : null;
  const cronograma = (o.cronograma || []).filter(m => m.hora?.trim() || m.descricao?.trim());
  const nota = o.nota_cliente?.trim() || '';
  if (!ponto && !cronograma.length && !nota) return null;
  return { ponto, cronograma, nota };
};

/** Duração em horas, com meia hora escrita como o Brasil escreve (10,5). */
export const duracaoTexto = (h?: number | null) => {
  const n = Number(h);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? 'hora' : 'horas'}`;
};

/** O mês de hoje em 'AAAA-MM', pelo relógio local. `toISOString()` é UTC e
 *  viraria o mês cedo demais na virada do dia, aqui no fuso do Brasil. */
export const mesDeHoje = () => {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`;
};

export const quandoRelativo = (s: string) => {
  const d = Math.floor((Date.now() - new Date(s).getTime()) / 86400000);
  if (d <= 0) return 'hoje';
  if (d === 1) return 'ontem';
  if (d < 30) return `há ${d} dias`;
  return dia(s) || '';
};

/** Nome de arquivo vira nome de peça: sem extensão e sem underline. */
export const nomeBonito = (f: string) => f.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();

/** A classe do formato sai do tamanho real do vídeo. */
export const formato = (l: number | null, a: number | null) => {
  if (!l || !a) return { classe: 'f169', rotulo: '16:9' };
  const r = l / a;
  if (r < 0.85) return { classe: 'f916', rotulo: '9:16' };
  if (r < 1.2) return { classe: 'f11', rotulo: '1:1' };
  return { classe: 'f169', rotulo: '16:9' };
};
