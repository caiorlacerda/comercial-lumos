import { Children, type ReactNode } from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import logo from '../../assets/Logotipo-Preto-Alpha.png';
import '@/lib/pdfFonts';
import type { Contato, MembroEquipe, SecoesAtivas, Talento } from '@/types/ordemDoDia';

/**
 * A CALL SHEET DA EQUIPE, inteira.
 *
 * Este é o PDF interno: sai tudo o que foi preenchido nas nove abas da
 * `OrdemDoDiaDetalhe`, porque é o papel que a equipe leva pro set e o arquivo
 * que roda no grupo na véspera. O PDF do CLIENTE é outro componente
 * (`OrdemDoDiaClientePDF`), com um recorte muito menor e proposital: não
 * misture os dois.
 *
 * Duas regras que guiaram o desenho daqui:
 *
 * 1. **Bloco vazio não vira título.** Cada seção só é desenhada quando tem
 *    conteúdo. Uma call sheet com oito cabeçalhos e nada embaixo é pior que
 *    uma call sheet curta.
 * 2. **A ordem é a do set, não a das abas.** Primeiro o que a pessoa precisa
 *    antes de sair de casa (data, horário, ponto de encontro, call times),
 *    depois o dia acontecendo (cronograma e locações), depois as listas de
 *    apoio (elenco, equipe, contatos, objetos, figurino, equipamentos,
 *    roteiros) e por fim as regras e o recado ao cliente.
 *
 * Legibilidade acima de beleza: isso é impresso em preto e branco e aberto no
 * celular embaixo de sol. Fundo branco, texto escuro, nada de cinza claro
 * sobre branco, nada de tarja escura atrás de letra miúda.
 */

// ─── Entrada ────────────────────────────────────────────────────────────────
// O que a tela tem em mãos. Nenhum campo novo: é o mesmo dado das nove abas.

interface ItemPDF { nome: string; desc?: string; personagem?: string }
interface RoteiroPDF { id?: string; name: string; url: string }
interface CallTimePDF { grupo: string; hora: string }
interface LocacaoPDF { nome: string; endereco: string; observacoes: string }
interface RegrasPDF { vestimenta?: string; redes?: string; setup_camera?: string; outras?: string }
/** O momento do cronograma, com os campos que a versão 2.0 acrescentou. */
interface MomentoPDF {
  inicio: string; fim: string; descricao: string; responsavel: string; destaque: boolean;
  tipo?: string; locacao?: string; chegada?: string; paralelo?: boolean;
}

export interface OrdemDoDiaPDFData {
  codigo?: string;
  titulo: string;
  data_producao: string | null;
  data_emissao?: string | null;
  clima?: string | null;
  ponto_encontro?: { nome: string; endereco: string } | null;
  call_times?: CallTimePDF[] | null;
  locacoes?: LocacaoPDF[] | null;
  contatos?: Contato[] | null;
  equipe?: MembroEquipe[] | null;
  plano_acao?: MomentoPDF[] | null;
  talentos?: Talento[] | null;
  objetos?: ItemPDF[] | null;
  figurino?: ItemPDF[] | null;
  equipamentos?: ItemPDF[] | null;
  roteiros?: RoteiroPDF[] | null;
  regras?: RegrasPDF | null;
  nota_cliente?: string | null;
  /** A tela não liga nem desliga seção, mas o campo existe no banco: se vier
   *  com um `false`, o PDF respeita. Ausente ou indefinido significa visível. */
  secoes_ativas?: Partial<SecoesAtivas> | null;
}

const TIPO_LABEL: Record<string, string> = {
  gravacao: 'Gravação', producao: 'Produção', desproducao: 'Desprodução',
  almoco: 'Almoço', jantar: 'Jantar', lanche: 'Lanche',
  deslocamento: 'Deslocamento', intervalo: 'Intervalo', personalizado: 'Personalizado',
};

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: 36,
    paddingTop: 28,
    paddingBottom: 54,
    backgroundColor: '#FFFFFF',
    fontFamily: 'Work Sans',
    color: '#1A1A1A',
    fontSize: 9.5,
  },
  // Cabeçalho que se repete em toda página: logo, nome da diária e data.
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 6,
  },
  headerRight: {
    textAlign: 'right',
    maxWidth: '58%',
  },
  headerTitulo: {
    fontFamily: 'Poppins',
    fontWeight: 700,
    fontSize: 11,
    color: '#111111',
  },
  headerData: {
    fontSize: 9,
    color: '#333333',
    marginTop: 2,
  },
  headerLine: {
    borderBottomWidth: 2,
    borderBottomColor: '#E8C64A',
    marginBottom: 12,
  },
  // Bloco de identificação (Diária / Data / Horário / Emissão)
  idBlock: {
    borderWidth: 0.75,
    borderColor: '#8A8A8A',
    marginBottom: 4,
  },
  idRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.75,
    borderBottomColor: '#8A8A8A',
  },
  idLabelCol: {
    width: '16%',
    backgroundColor: 'rgba(0,0,0,0.07)',
    padding: 5,
    borderRightWidth: 0.75,
    borderRightColor: '#8A8A8A',
    fontFamily: 'Poppins',
    fontWeight: 700,
    fontSize: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    color: '#333333',
  },
  idValueCol: {
    width: '34%',
    padding: 5,
    fontSize: 9.5,
    borderRightWidth: 0.75,
    borderRightColor: '#8A8A8A',
  },
  // Cabeçalho de seção
  secao: { marginTop: 14 },
  sectionHeader: {
    backgroundColor: '#F0D269',
    borderBottomWidth: 1.5,
    borderBottomColor: '#1A1A1A',
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginBottom: 5,
  },
  sectionHeaderText: {
    fontFamily: 'Poppins',
    fontWeight: 700,
    fontSize: 10,
    color: '#111111',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  subTitulo: {
    fontFamily: 'Poppins',
    fontWeight: 700,
    fontSize: 9,
    color: '#111111',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 6,
    marginBottom: 2,
    paddingHorizontal: 4,
  },
  paragrafo: {
    fontSize: 9.5,
    color: '#1A1A1A',
    lineHeight: 1.45,
    paddingHorizontal: 4,
    paddingBottom: 3,
  },
  // Tabelas
  tableHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
    paddingVertical: 4,
    paddingHorizontal: 4,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  cellHeader: {
    fontSize: 8,
    color: '#2B2B2B',
    fontFamily: 'Poppins',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    paddingRight: 4,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#B4B4B4',
    paddingVertical: 5,
    paddingHorizontal: 4,
  },
  tableRowAlt: { backgroundColor: 'rgba(0,0,0,0.045)' },
  // Marco do dia: barra na lateral e negrito, em vez de tarja escura
  tableRowDestaque: {
    backgroundColor: 'rgba(0,0,0,0.09)',
    borderLeftWidth: 3,
    borderLeftColor: '#1A1A1A',
    paddingLeft: 5,
  },
  cell: { fontSize: 9.5, color: '#1A1A1A', paddingRight: 4 },
  cellBold: { fontSize: 9.5, color: '#111111', fontFamily: 'Poppins', fontWeight: 700, paddingRight: 4 },
  cellNota: { fontSize: 8, color: '#3A3A3A', marginTop: 1.5 },
  // Bloco chave e valor
  kvBlock: { paddingHorizontal: 4, paddingVertical: 2 },
  kvRow: { flexDirection: 'row', marginBottom: 3 },
  kvLabel: {
    width: '20%',
    fontSize: 8,
    color: '#333333',
    fontFamily: 'Poppins',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  kvValue: { flex: 1, fontSize: 9.5, color: '#1A1A1A', lineHeight: 1.4 },
  // Lista de locações
  locItem: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#B4B4B4',
    paddingVertical: 5,
    paddingHorizontal: 4,
  },
  locOrdem: {
    width: 26,
    fontFamily: 'Poppins',
    fontWeight: 700,
    fontSize: 9.5,
    color: '#111111',
  },
  locNome: { fontFamily: 'Poppins', fontWeight: 700, fontSize: 10, color: '#111111' },
  locLinha: { fontSize: 9, color: '#2B2B2B', lineHeight: 1.4, marginTop: 1 },
  // Equipe em duas colunas
  twoColRow: { flexDirection: 'row', gap: 12 },
  col: { flex: 1 },
  equipeItem: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: '#B4B4B4',
  },
  equipeFuncao: {
    width: '45%',
    fontSize: 8,
    color: '#2B2B2B',
    fontFamily: 'Poppins',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    paddingRight: 4,
  },
  equipeNome: { flex: 1, fontSize: 9.5, color: '#1A1A1A' },
  // Rodapé
  footer: {
    position: 'absolute',
    bottom: 22,
    left: 36,
    right: 36,
    borderTopWidth: 0.75,
    borderTopColor: '#8A8A8A',
    paddingTop: 5,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: { fontSize: 7.5, color: '#3A3A3A', letterSpacing: 0.5 },
});

interface OrdemDoDiaPDFProps {
  ordem: OrdemDoDiaPDFData;
}

const formatDataLonga = (dateStr?: string | null, comDiaDaSemana = false): string => {
  if (!dateStr) return 'Data a definir';
  try {
    const d = new Date(dateStr.slice(0, 10) + 'T12:00:00');
    const s = format(d, comDiaDaSemana ? "EEEE, dd 'de' MMMM 'de' yyyy" : "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
    return s.charAt(0).toUpperCase() + s.slice(1);
  } catch {
    return dateStr;
  }
};

const emMinutos = (h?: string | null): number | null => {
  if (!h) return null;
  const [a, b] = h.split(':').map(Number);
  if (Number.isNaN(a)) return null;
  return a * 60 + (b || 0);
};
const deMinutos = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const temTexto = (v?: string | null) => !!(v && v.trim());
/** As fontes latinas do PDF não têm a seta que o cronograma usa na tela
 *  ("Deslocamento: A → B"): sem isso ela imprime como caractere trocado. */
const semSeta = (v?: string | null) => (v || '').replace(/\s*(→|->)\s*/g, ' para ');
const lista = <T,>(v?: T[] | null): T[] => (Array.isArray(v) ? v : []);

/**
 * Cabeçalho de seção mais o começo do conteúdo, colados num bloco que não
 * quebra: título sozinho no pé da página é o mesmo que título sem conteúdo.
 * `agrupar` diz quantos filhos vão junto do título (2 nas tabelas, pra levar
 * o cabeçalho das colunas e a primeira linha). O `minPresenceAhead` do
 * @react-pdf não deu conta disso, medido no PDF gerado.
 */
const Secao = ({ titulo, agrupar = 1, children }: { titulo: string; agrupar?: number; children: ReactNode }) => {
  const itens = Children.toArray(children);
  return (
    <View style={styles.secao}>
      <View wrap={false}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionHeaderText}>{titulo}</Text>
        </View>
        {itens.slice(0, agrupar)}
      </View>
      {itens.slice(agrupar)}
    </View>
  );
};

/** Lista simples de itens (objetos, figurino, equipamentos). Devolve as linhas
 *  soltas, e não um componente, pra `Secao` conseguir colar o começo no título. */
const linhasDeItens = (itens: ItemPDF[], colunaDireita: string): ReactNode[] => [
  <View key="cab" style={styles.tableHeaderRow}>
    <Text style={[styles.cellHeader, { width: '42%' }]}>Item</Text>
    <Text style={[styles.cellHeader, { width: '58%' }]}>{colunaDireita}</Text>
  </View>,
  ...itens.map((it, i) => (
    <View key={i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]} wrap={false}>
      <Text style={[styles.cellBold, { width: '42%' }]}>{it.nome}</Text>
      <Text style={[styles.cell, { width: '58%' }]}>{it.personagem || it.desc || ''}</Text>
    </View>
  )),
];

export const OrdemDoDiaPDF = ({ ordem }: OrdemDoDiaPDFProps) => {
  if (!ordem) return null;

  const secoes = ordem.secoes_ativas || {};
  /** Sem flag no banco, a seção aparece: quem manda é ter conteúdo. */
  const ligada = (chave: keyof SecoesAtivas) => secoes[chave] !== false;

  const dataEmissao = formatDataLonga(ordem.data_emissao || new Date().toISOString());
  const dataProducao = formatDataLonga(ordem.data_producao, true);
  const dataCurta = formatDataLonga(ordem.data_producao);
  const nomenclatura = `LUMOS · ${ordem.titulo} · ORDEM DO DIA`;

  const callTimes = lista(ordem.call_times).filter(c => temTexto(c.grupo) || temTexto(c.hora));
  const locacoes = lista(ordem.locacoes).filter(l => temTexto(l.nome) || temTexto(l.endereco));
  const contatos = lista(ordem.contatos);
  const equipe = lista(ordem.equipe);
  const cronograma = lista(ordem.plano_acao);
  const talentos = lista(ordem.talentos);
  const objetos = lista(ordem.objetos).filter(i => temTexto(i.nome));
  const figurino = lista(ordem.figurino).filter(i => temTexto(i.nome));
  const equipamentos = lista(ordem.equipamentos).filter(i => temTexto(i.nome));
  const roteiros = lista(ordem.roteiros).filter(r => temTexto(r.name));
  const regras = ordem.regras || {};
  const ponto = ordem.ponto_encontro;

  // Horário da diária: sai do próprio cronograma, igual à tela.
  const inicios = cronograma.map(m => emMinutos(m.inicio)).filter((n): n is number => n != null);
  const fins = cronograma.map(m => emMinutos(m.fim) ?? emMinutos(m.inicio)).filter((n): n is number => n != null);
  const horaInicio = inicios.length ? Math.min(...inicios) : null;
  const horaFim = fins.length ? Math.max(...fins) : null;
  const totalMin = horaInicio != null && horaFim != null && horaFim > horaInicio ? horaFim - horaInicio : null;
  const horarioTexto = horaInicio != null && horaFim != null
    ? `${deMinutos(horaInicio)} às ${deMinutos(horaFim)}${totalMin ? `, ${Math.floor(totalMin / 60)}h${totalMin % 60 ? ` ${totalMin % 60}min` : ''} no total` : ''}`
    : 'A definir no cronograma';

  const equipeMid = Math.ceil(equipe.length / 2);
  const equipeColA = equipe.slice(0, equipeMid);
  const equipeColB = equipe.slice(equipeMid);

  const regrasPreenchidas = [
    { titulo: 'Vestimenta', valor: regras.vestimenta },
    { titulo: 'Postagem em redes sociais', valor: regras.redes },
    { titulo: 'Setup de câmera', valor: regras.setup_camera },
    { titulo: 'Outras observações', valor: regras.outras },
  ].filter(r => temTexto(r.valor));

  return (
    <Document title={`OD_LUMOS_${(ordem.codigo || '').replace('#', '')}_${ordem.titulo}`}>
      <Page size="A4" style={styles.page} wrap>
        {/* Cabeçalho, repetido em toda página com o nome da diária e a data */}
        <View style={styles.header} fixed>
          <Image src={logo} style={{ width: 118 }} />
          <View style={styles.headerRight}>
            <Text style={styles.headerTitulo}>{ordem.titulo}</Text>
            <Text style={styles.headerData}>Ordem do dia, {dataCurta}</Text>
          </View>
        </View>
        <View style={styles.headerLine} fixed />

        {/* ═══ ANTES DE SAIR DE CASA ═══ */}

        {/* Identificação */}
        <View style={styles.idBlock}>
          <View style={styles.idRow}>
            <View style={styles.idLabelCol}><Text>Diária</Text></View>
            <View style={styles.idValueCol}><Text style={{ fontFamily: 'Poppins', fontWeight: 700 }}>{ordem.titulo}</Text></View>
            <View style={styles.idLabelCol}><Text>Data</Text></View>
            <View style={[styles.idValueCol, { borderRightWidth: 0 }]}><Text style={{ fontFamily: 'Poppins', fontWeight: 700 }}>{dataProducao}</Text></View>
          </View>
          <View style={[styles.idRow, { borderBottomWidth: 0 }]}>
            <View style={styles.idLabelCol}><Text>Horário</Text></View>
            <View style={styles.idValueCol}><Text>{horarioTexto}</Text></View>
            <View style={styles.idLabelCol}><Text>Emissão</Text></View>
            <View style={[styles.idValueCol, { borderRightWidth: 0 }]}><Text>{dataEmissao}</Text></View>
          </View>
        </View>

        {/* Clima */}
        {ligada('clima') && temTexto(ordem.clima) && (
          <Secao titulo="Clima">
            <Text style={styles.paragrafo}>{ordem.clima}</Text>
          </Secao>
        )}

        {/* Ponto de encontro */}
        {ligada('ponto_encontro') && ponto && (temTexto(ponto.nome) || temTexto(ponto.endereco)) && (
          <Secao titulo="Ponto de encontro">
            <View style={styles.kvBlock} wrap={false}>
              {temTexto(ponto.nome) && (
                <View style={styles.kvRow}>
                  <Text style={styles.kvLabel}>Local</Text>
                  <Text style={styles.kvValue}>{ponto.nome}</Text>
                </View>
              )}
              {temTexto(ponto.endereco) && (
                <View style={styles.kvRow}>
                  <Text style={styles.kvLabel}>Endereço</Text>
                  <Text style={styles.kvValue}>{ponto.endereco}</Text>
                </View>
              )}
            </View>
          </Secao>
        )}

        {/* Call times */}
        {callTimes.length > 0 && (
          <Secao titulo="Call times" agrupar={2}>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.cellHeader, { width: '70%' }]}>Grupo</Text>
              <Text style={[styles.cellHeader, { width: '30%' }]}>Chegada</Text>
            </View>
            {callTimes.map((c, i) => (
              <View key={i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]} wrap={false}>
                <Text style={[styles.cell, { width: '70%' }]}>{c.grupo}</Text>
                <Text style={[styles.cellBold, { width: '30%' }]}>{c.hora}</Text>
              </View>
            ))}
          </Secao>
        )}

        {/* ═══ O DIA ACONTECENDO ═══ */}

        {/* Cronograma */}
        {ligada('plano_acao') && cronograma.length > 0 && (
          <Secao titulo="Cronograma" agrupar={2}>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.cellHeader, { width: '20%' }]}>Horário</Text>
              <Text style={[styles.cellHeader, { width: '43%' }]}>Atividade</Text>
              <Text style={[styles.cellHeader, { width: '19%' }]}>Local</Text>
              <Text style={[styles.cellHeader, { width: '18%' }]}>Responsável</Text>
            </View>
            {cronograma.map((m, i) => {
              const horario = temTexto(m.fim) ? `${m.inicio} às ${m.fim}` : (m.inicio || '');
              const Celula = m.destaque ? styles.cellBold : styles.cell;
              const rowBg = m.destaque ? styles.tableRowDestaque : (i % 2 === 1 ? styles.tableRowAlt : {});
              const tipo = m.tipo ? (TIPO_LABEL[m.tipo] || '') : '';
              const nota = [tipo, m.paralelo ? 'em paralelo' : ''].filter(Boolean).join(', ');
              const local = m.locacao || m.chegada || '';
              return (
                <View key={i} style={[styles.tableRow, rowBg]} wrap={false}>
                  <Text style={[Celula, { width: '20%' }]}>{horario}</Text>
                  <View style={{ width: '43%' }}>
                    <Text style={Celula}>{semSeta(m.descricao) || tipo}</Text>
                    {!!nota && <Text style={styles.cellNota}>{nota}</Text>}
                  </View>
                  <Text style={[styles.cell, { width: '19%' }]}>{local}</Text>
                  <Text style={[styles.cell, { width: '18%' }]}>{m.responsavel || ''}</Text>
                </View>
              );
            })}
          </Secao>
        )}

        {/* Locações, todas as incluídas */}
        {ligada('locacao') && locacoes.length > 0 && (
          <Secao titulo={locacoes.length > 1 ? `Locações (${locacoes.length})` : 'Locação'}>
            {locacoes.map((l, i) => (
              <View key={i} style={styles.locItem} wrap={false}>
                {locacoes.length > 1 && <Text style={styles.locOrdem}>{i + 1}ª</Text>}
                <View style={{ flex: 1 }}>
                  <Text style={styles.locNome}>{l.nome}</Text>
                  {temTexto(l.endereco) && <Text style={styles.locLinha}>{l.endereco}</Text>}
                  {temTexto(l.observacoes) && <Text style={styles.locLinha}>{l.observacoes}</Text>}
                </View>
              </View>
            ))}
          </Secao>
        )}

        {/* ═══ LISTAS DE APOIO ═══ */}

        {/* Elenco */}
        {ligada('talentos') && talentos.length > 0 && (
          <Secao titulo="Elenco" agrupar={2}>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.cellHeader, { width: '24%' }]}>Nome</Text>
              <Text style={[styles.cellHeader, { width: '20%' }]}>Papel</Text>
              <Text style={[styles.cellHeader, { width: '12%' }]}>Chegada</Text>
              <Text style={[styles.cellHeader, { width: '12%' }]}>Gravação</Text>
              <Text style={[styles.cellHeader, { width: '32%' }]}>Observações</Text>
            </View>
            {talentos.map((t, i) => (
              <View key={i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]} wrap={false}>
                <Text style={[styles.cellBold, { width: '24%' }]}>{t.nome || ''}</Text>
                <Text style={[styles.cell, { width: '20%' }]}>{t.funcao || 'Papel a definir'}</Text>
                <Text style={[styles.cell, { width: '12%' }]}>{t.horario_chegada || ''}</Text>
                <Text style={[styles.cell, { width: '12%' }]}>{t.horario_gravacao || ''}</Text>
                <Text style={[styles.cell, { width: '32%' }]}>{t.obs || ''}</Text>
              </View>
            ))}
          </Secao>
        )}

        {/* Equipe, ficha técnica em duas colunas */}
        {ligada('equipe') && equipe.length > 0 && (
          <Secao titulo={`Equipe (${equipe.length})`}>
            <View style={styles.twoColRow}>
              <View style={styles.col}>
                {equipeColA.map((m, i) => (
                  <View key={i} style={[styles.equipeItem, i % 2 === 1 ? styles.tableRowAlt : {}]} wrap={false}>
                    <Text style={styles.equipeFuncao}>{m.funcao || 'Função a definir'}</Text>
                    <Text style={styles.equipeNome}>{m.nome || ''}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.col}>
                {equipeColB.map((m, i) => (
                  <View key={i} style={[styles.equipeItem, i % 2 === 1 ? styles.tableRowAlt : {}]} wrap={false}>
                    <Text style={styles.equipeFuncao}>{m.funcao || 'Função a definir'}</Text>
                    <Text style={styles.equipeNome}>{m.nome || ''}</Text>
                  </View>
                ))}
              </View>
            </View>
          </Secao>
        )}

        {/* Contatos */}
        {ligada('contatos') && contatos.length > 0 && (
          <Secao titulo="Contatos" agrupar={2}>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.cellHeader, { width: '35%' }]}>Função ou empresa</Text>
              <Text style={[styles.cellHeader, { width: '40%' }]}>Nome</Text>
              <Text style={[styles.cellHeader, { width: '25%' }]}>Telefone</Text>
            </View>
            {contatos.map((c, i) => (
              <View key={i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]} wrap={false}>
                <Text style={[styles.cell, { width: '35%', fontFamily: 'Poppins', fontWeight: 700, fontSize: 8, textTransform: 'uppercase', letterSpacing: 0.3, color: '#2B2B2B' }]}>
                  {c.funcao || ''}
                </Text>
                <Text style={[styles.cell, { width: '40%' }]}>{c.nome || ''}</Text>
                <Text style={[styles.cellBold, { width: '25%' }]}>{c.telefone || ''}</Text>
              </View>
            ))}
          </Secao>
        )}

        {/* Objetos de cena */}
        {objetos.length > 0 && (
          <Secao titulo="Objetos de cena" agrupar={2}>
            {linhasDeItens(objetos, 'Descrição')}
          </Secao>
        )}

        {/* Figurino */}
        {figurino.length > 0 && (
          <Secao titulo="Figurino" agrupar={2}>
            {linhasDeItens(figurino, 'Personagem')}
          </Secao>
        )}

        {/* Equipamentos */}
        {equipamentos.length > 0 && (
          <Secao titulo="Equipamentos" agrupar={2}>
            {linhasDeItens(equipamentos, 'Descrição')}
          </Secao>
        )}

        {/* Roteiros */}
        {roteiros.length > 0 && (
          <Secao titulo="Roteiros">
            {roteiros.map((r, i) => (
              <View key={i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]} wrap={false}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cellBold}>{r.name}</Text>
                  {temTexto(r.url) && <Text style={styles.cellNota}>{r.url}</Text>}
                </View>
              </View>
            ))}
          </Secao>
        )}

        {/* ═══ REGRAS E OBSERVAÇÕES ═══ */}

        {regrasPreenchidas.length > 0 && (
          <Secao titulo="Regras do set">
            {regrasPreenchidas.map((r, i) => (
              <View key={i} wrap={false}>
                <Text style={styles.subTitulo}>{r.titulo}</Text>
                <Text style={styles.paragrafo}>{r.valor}</Text>
              </View>
            ))}
          </Secao>
        )}

        {temTexto(ordem.nota_cliente) && (
          <Secao titulo="Recado para o cliente">
            <Text style={styles.paragrafo}>{ordem.nota_cliente}</Text>
            <Text style={[styles.cellNota, { paddingHorizontal: 4 }]}>
              Este é o único texto desta ordem do dia que o cliente também lê, no portal dele.
            </Text>
          </Secao>
        )}

        {/* Rodapé com numeração */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>{nomenclatura}</Text>
          <Text style={styles.footerText} render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
};
