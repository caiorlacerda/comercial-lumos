import { Fragment } from 'react';
import { Document, Page, Text, View, StyleSheet, Font, Image } from '@react-pdf/renderer';
import { BudgetItem, BudgetVersion, VersionFinancials } from '@/utils/financials';
import { formatBudgetCode } from '@/utils/formatters';
import { formatarMoeda, formatarValorDaVersao, moedaDaVersao } from '@/utils/moeda';
import { getTextos } from '@/lib/pdfTextos';
import { traduzir } from '@/lib/traducaoCore';
import { format, parseISO } from 'date-fns';
import { enUS, ptBR } from 'date-fns/locale';
import logo from '../../assets/Logotipo-Preto-Alpha.png';
import { renderRichNotes } from '@/components/editor/richTextPdf';

// 1. REGISTRO DE FONTES
Font.register({
  family: 'Poppins',
  fonts: [
    { src: 'https://cdn.jsdelivr.net/fontsource/fonts/poppins@latest/latin-400-normal.ttf' },
    { src: 'https://cdn.jsdelivr.net/fontsource/fonts/poppins@latest/latin-600-normal.ttf', fontWeight: 600 },
    { src: 'https://cdn.jsdelivr.net/fontsource/fonts/poppins@latest/latin-700-normal.ttf', fontWeight: 700 },
    // Itálicas: sem elas, um texto em itálico no briefing quebrava o PDF inteiro.
    { src: 'https://cdn.jsdelivr.net/fontsource/fonts/poppins@latest/latin-400-italic.ttf', fontStyle: 'italic' },
    { src: 'https://cdn.jsdelivr.net/fontsource/fonts/poppins@latest/latin-700-italic.ttf', fontWeight: 700, fontStyle: 'italic' },
  ],
});

Font.register({
  family: 'Work Sans',
  fonts: [
    { src: 'https://cdn.jsdelivr.net/fontsource/fonts/work-sans@latest/latin-400-normal.ttf' },
    { src: 'https://cdn.jsdelivr.net/fontsource/fonts/work-sans@latest/latin-600-normal.ttf', fontWeight: 600 },
    { src: 'https://cdn.jsdelivr.net/fontsource/fonts/work-sans@latest/latin-700-normal.ttf', fontWeight: 700 },
    { src: 'https://cdn.jsdelivr.net/fontsource/fonts/work-sans@latest/latin-400-italic.ttf', fontStyle: 'italic' },
    { src: 'https://cdn.jsdelivr.net/fontsource/fonts/work-sans@latest/latin-700-italic.ttf', fontWeight: 700, fontStyle: 'italic' },
  ],
});

// 2. ESTILOS
const styles = StyleSheet.create({
  page: {
    padding: 40,
    backgroundColor: '#F5F5F3', // Bege claro Lumos
    fontFamily: 'Work Sans',
    color: '#1a1a1a',
    fontSize: 8,
    position: 'relative',
  },
  
  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
    paddingBottom: 8,
  },
  logo: {
    width: 140,
  },
  companyInfo: {
    textAlign: 'right',
    fontSize: 7,
    lineHeight: 1.4,
    color: '#1a1a1a',
  },
  headerLine: {
    borderBottomWidth: 2,
    borderBottomColor: '#F5D87A', // Novo amarelo suave
    marginBottom: 8,
  },

  // ID Block Table
  idBlock: {
    marginBottom: 8,
    borderWidth: 0.5,
    borderColor: '#dcdcdc',
  },
  idRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#dcdcdc',
  },
  idLabelCol: {
    width: '15%',
    backgroundColor: 'rgba(0,0,0,0.03)',
    padding: 4,
    borderRightWidth: 0.5,
    borderRightColor: '#dcdcdc',
    fontFamily: 'Poppins',
    fontWeight: 700,
    fontSize: 7,
    textTransform: 'uppercase',
    color: '#666',
  },
  idValueCol: {
    width: '35%',
    padding: 4,
    fontSize: 8,
    fontFamily: 'Work Sans',
    fontWeight: 400,
  },
  idMetaCol: {
    width: '50%',
    textAlign: 'right',
    padding: 6,
    justifyContent: 'center',
  },
  idProposalNum: {
    fontFamily: 'Poppins',
    fontWeight: 700,
    fontSize: 9,
    color: '#1a1a1a',
  },
  idDate: {
    fontSize: 7,
    color: '#666',
    marginTop: 2,
  },
  
  // Nomenclature Tag (Subheader)
  nomenclatureTag: {
    fontSize: 7,
    color: '#888888',
    fontFamily: 'Poppins',
    fontWeight: 400,
    marginBottom: 10,
    marginTop: 8,
  },

  // Section Briefing
  sectionTitle: {
    fontFamily: 'Poppins',
    fontWeight: 700,
    fontSize: 10,
    textTransform: 'uppercase',
    color: '#1a1a1a',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  briefingText: {
    marginBottom: 12,
    lineHeight: 1.5,
    color: '#333',
    textAlign: 'justify',
    fontSize: 8,
  },

  // Table
  table: {
    marginTop: 10,
    marginBottom: 12,
  },
  groupHeader: {
    backgroundColor: '#F5D87A', // Novo amarelo suave
    paddingVertical: 6,
    paddingHorizontal: 10,
    fontFamily: 'Poppins',
    fontWeight: 700,
    fontSize: 8,
    textTransform: 'uppercase',
    color: '#000',
    flexDirection: 'row',
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#F5D87A',
    paddingVertical: 4,
    paddingHorizontal: 6,
    backgroundColor: 'rgba(0,0,0,0.02)',
  },
  tableHeaderCell: {
    fontFamily: 'Poppins',
    fontWeight: 700,
    fontSize: 7,
    textTransform: 'uppercase',
    color: '#666',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center',
  },
  tableRowEven: {
    backgroundColor: 'rgba(0,0,0,0.02)',
  },
  tableCell: {
    fontSize: 8,
    color: '#1a1a1a',
  },
  
  // Specific Columns
  colName: { width: '30%' },
  colDesc: { width: '40%' },
  colQty: { width: '15%', textAlign: 'center' },
  colUnit: { width: '15%', textAlign: 'center' },

  // Modo detalhado: as mesmas colunas, mais estreitas, abrindo espaço pro
  // valor unitário e o total de cada item.
  colNameD: { width: '26%' },
  colDescD: { width: '26%' },
  colQtyD: { width: '8%', textAlign: 'center' },
  colUnitD: { width: '12%', textAlign: 'center' },
  colValorD: { width: '14%', textAlign: 'right' },
  colTotalD: { width: '14%', textAlign: 'right' },

  // Group Subtotal
  groupSubtotalRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingVertical: 5,
    paddingHorizontal: 6,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
    marginBottom: 8,
  },
  groupSubtotalText: {
    fontFamily: 'Poppins',
    fontWeight: 700,
    fontSize: 7,
    textTransform: 'uppercase',
    color: '#666',
    marginRight: 10,
  },
  groupSubtotalValue: {
    fontFamily: 'Work Sans',
    fontWeight: 600,
    fontSize: 8,
    color: '#1a1a1a',
  },

  // Final Total
  totalContainer: {
    marginTop: 8,
    paddingVertical: 8,
    borderTopWidth: 2,
    borderTopColor: '#1a1a1a',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    fontFamily: 'Poppins',
    fontWeight: 700,
    fontSize: 12,
    textTransform: 'uppercase',
    color: '#1a1a1a',
  },
  totalValue: {
    fontFamily: 'Poppins',
    fontWeight: 700,
    fontSize: 18,
    color: '#1a1a1a', // Alterado para preto para ser mais elegante com o fundo bege
  },
  totalValueAccent: {
     color: '#F5D87A',
  },

  // Condições Gerais
  conditionsList: {
    marginTop: 10,
    marginBottom: 15,
  },
  conditionSection: {
    marginBottom: 8,
  },
  conditionTitle: {
    fontFamily: 'Poppins',
    fontWeight: 700,
    fontSize: 9,
    textTransform: 'uppercase',
    color: '#101010',
    marginBottom: 4,
  },
  conditionText: {
    fontSize: 7.5,
    lineHeight: 1.4,
    color: '#333',
    marginBottom: 3,
  },

  // Logistics Block
  logisticsBlock: {
    backgroundColor: 'rgba(245, 216, 122, 0.05)',
    borderWidth: 0.5,
    borderColor: '#F5D87A',
    borderRadius: 2,
    padding: 8,
    marginBottom: 10,
    flexDirection: 'row',
  },
  logisticsItem: {
    flex: 1,
  },
  logisticsLabel: {
    fontFamily: 'Poppins',
    fontWeight: 700,
    fontSize: 6,
    color: '#888',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  logisticsValue: {
    fontSize: 7.5,
    color: '#1a1a1a',
    fontWeight: 600,
  },

  // Signature Blocks
  signatureContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 30,
  },
  signatureBox: {
    width: '45%',
    alignItems: 'flex-start',
  },
  signatureTitle: {
    fontFamily: 'Poppins',
    fontWeight: 700,
    fontSize: 8,
    textTransform: 'uppercase',
    color: '#666',
    marginBottom: 30,
  },
  signatureLine: {
    width: '100%',
    borderTopWidth: 0.5,
    borderTopColor: '#1a1a1a',
    marginBottom: 5,
  },
  signatureLabel: {
    fontSize: 7,
    color: '#1a1a1a',
    lineHeight: 1.4,
  },
  signatureName: {
     fontWeight: 700,
     textTransform: 'uppercase',
  },

  // Footer
  pageFooter: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'center',
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(0,0,0,0.05)',
    paddingTop: 10,
  },
  footerText: {
    fontSize: 6.5,
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 1,
  }
});

// Renderizador de rich text compartilhado com a OS (mesma formatação).

// 3. COMPONENTE
interface BudgetPDFProps {
  budget: any;
  version: BudgetVersion;
  contact?: any;
  items: BudgetItem[];
  financials: VersionFinancials;
  userName?: string;
  /** Proposta detalhada: mostra valor unitário e total de cada item. */
  detalhado?: boolean;
}

export const BudgetPDF = ({ budget, version, contact, items, financials, userName, detalhado = false }: BudgetPDFProps) => {
  if (!budget || !version || !financials) return null;

  // Idioma do PDF (independente da moeda). Em português a saída é idêntica à de sempre.
  const lang = version.pdf_language === 'en' ? 'en' : 'pt';
  const t = getTextos(lang);
  const dateLocale = lang === 'en' ? enUS : ptBR;
  // Textos do orçamento: em inglês vêm do glossário revisado guardado na versão;
  // sem tradução saem no original. Em português passam direto.
  const tr = (s?: string | null): string => (lang === 'en' ? traduzir(version.translations, s) : String(s ?? ''));

  const dateStr = format(new Date(), t.formatoData, { locale: dateLocale });
  const markupMultiplier = financials.valorFinal / (financials.totalCusto || 1);

  // Em proposta em dólar o PDF mostra SÓ US$ (sem cotação e sem reais). Cada valor
  // é convertido e arredondado sozinho; o total é convertido uma única vez.
  const fmt = (valorBRL: number) => formatarValorDaVersao(valorBRL, version, t.locale);
  const taxaRemarcacao = moedaDaVersao(version) === 'USD' ? fmt(2000) : t.taxaRemarcacaoBRL;

  // Categoria: mapa do idioma, ou o slug capitalizado (como sempre foi em português).
  const categoryFormatted = budget.category
    ? (t.categorias[budget.category] ?? budget.category.charAt(0).toUpperCase() + budget.category.slice(1).toLowerCase())
    : '—';

  const groups = ['equipe', 'equipamentos', 'producao', 'edicao'] as const;

  // Novo padrão de nomenclatura: [CODE] | Lumos + [AGÊNCIA] [CLIENTE] | [NOME DO PROJETO]
  const clientDisplayName = budget.clients?.agency_name
    ? `${budget.clients.agency_name} + ${budget.clients.name}`
    : (budget.clients?.name || t.clienteFallback);

  const formattedCode = formatBudgetCode(budget.code);
  const nomenclatureHeader = `${formattedCode} | Lumos + ${clientDisplayName} | ${budget.project_name}`;
  const proposalTag = nomenclatureHeader;

  const cabecalho = (
    <>
      <View style={styles.header}>
        <Image src={logo} style={{ width: 144 }} />
        <View style={styles.companyInfo}>
          <Text style={{ fontWeight: 700 }}>Produtora Lumos Audiovisual Ltda.</Text>
          <Text>CNPJ: 51.253.010/0001-70</Text>
          <Text>R. Jaceru, 384 - Cj. 1604 - Vila Gertrudes</Text>
          <Text>São Paulo - SP, 04705-000</Text>
          <Text>comercial@produtoralumos.com.br</Text>
          <Text>+55 (11) 98667-6747</Text>
          <Text>www.produtoralumos.com.br</Text>
        </View>
      </View>
      <View style={styles.headerLine} />
    </>
  );

  // Cronograma do fee mensal (fee mensal nunca existe em US$): valores sempre em R$.
  // `null` explícito quando não se aplica: um '' solto dentro de uma <View> quebraria o react-pdf.
  const mostrarFee = version.payment_plan === 'fee_mensal' && !!version.fee_mensal_mostrar_na_proposta
    && !!version.fee_mensal_inicio && !!version.fee_mensal_fim;
  const feeMensal = !mostrarFee ? null : (
    <View style={{ marginTop: 2, marginBottom: 10 }} wrap={false}>
      <Text style={[styles.conditionText, { fontWeight: 700, marginBottom: 4 }]}>{t.feeTitulo}</Text>
      <View style={styles.tableHeader}>
        <Text style={[styles.tableHeaderCell, { width: '40%' }]}>{t.feeMes}</Text>
        <Text style={[styles.tableHeaderCell, { width: '30%', textAlign: 'right' }]}>{t.feeValorMensal}</Text>
        <Text style={[styles.tableHeaderCell, { width: '30%', textAlign: 'right' }]}>{t.feeAdendo}</Text>
      </View>
      {(() => {
        const linhas: { mes: string; adendo: number }[] = [];
        let cursor = parseISO(version.fee_mensal_inicio as string);
        const fim = parseISO(version.fee_mensal_fim as string);
        let guard = 0;
        while (cursor <= fim && guard < 60) {
          const mesKey = format(cursor, 'yyyy-MM');
          const adendo = (version.fee_mensal_adendos || [])
            .filter(a => a.mes === mesKey)
            .reduce((s, a) => s + Number(a.valor || 0), 0);
          linhas.push({ mes: mesKey, adendo });
          cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
          guard++;
        }
        return linhas.map((l, idx) => (
          <View key={l.mes} style={[styles.tableRow, idx % 2 === 1 ? styles.tableRowEven : {}]}>
            <Text style={[styles.tableCell, { width: '40%' }]}>{format(parseISO(`${l.mes}-01`), t.formatoMes, { locale: dateLocale })}</Text>
            <Text style={[styles.tableCell, { width: '30%', textAlign: 'right' }]}>{formatarMoeda(version.fee_mensal_valor || 0, 'BRL', t.locale)}</Text>
            <Text style={[styles.tableCell, { width: '30%', textAlign: 'right' }]}>{l.adendo > 0 ? formatarMoeda(l.adendo, 'BRL', t.locale) : '—'}</Text>
          </View>
        ));
      })()}
    </View>
  );

  return (
    <Document title={t.tituloDocumento(formattedCode.replace('#', ''), detalhado)}>
      {/* PÁGINA 1: PROPOSTA FINANCEIRA */}
      <Page size="A4" style={styles.page}>
        {/* Cabeçalho */}
        {cabecalho}

        {/* Nomenclatura acima do bloco */}
        <Text style={styles.nomenclatureTag}>{proposalTag}</Text>

        {/* Bloco de Identificação */}
        <View style={styles.idBlock}>
          <View style={styles.idRow}>
            <View style={styles.idLabelCol}><Text>{t.projeto}</Text></View>
            <View style={styles.idValueCol}><Text style={{ fontWeight: 700 }}>{budget.project_name}</Text></View>
            <View style={[styles.idMetaCol, { borderLeftWidth: 0.5, borderLeftColor: '#dcdcdc' }]}>
               <Text style={styles.idDate}>{t.emissao}: {dateStr}</Text>
            </View>
          </View>
          <View style={styles.idRow}>
            <View style={styles.idLabelCol}><Text>{t.cliente}</Text></View>
            <View style={styles.idValueCol}><Text>{clientDisplayName}</Text></View>
            <View style={[styles.idLabelCol, { borderLeftWidth: 0.5, borderLeftColor: '#dcdcdc' }]}><Text>{t.categoria}</Text></View>
            <View style={styles.idValueCol}><Text>{categoryFormatted}</Text></View>
          </View>
          <View style={[styles.idRow, { borderBottomWidth: 0 }]}>
            <View style={styles.idLabelCol}><Text>{t.contato}</Text></View>
            <View style={{ width: '85%', padding: 4 }}>
              <Text>{contact?.name || '—'}  ·  {contact?.email || '—'}</Text>
            </View>
          </View>
        </View>

        {/* Escopo e Briefing */}
        {(version.notes_client || version.logistics_date || version.logistics_time || version.logistics_location) && (
          <View>
            <Text style={styles.sectionTitle}>{t.escopo}</Text>

            {/* Bloco de Logística se preenchido */}
            {(version.logistics_date || version.logistics_time || version.logistics_location) && (
              <View style={styles.logisticsBlock}>
                {version.logistics_date && (
                  <View style={styles.logisticsItem}>
                    <Text style={styles.logisticsLabel}>{t.datas}</Text>
                    <Text style={styles.logisticsValue}>{tr(version.logistics_date)}</Text>
                  </View>
                )}
                {version.logistics_time && (
                  <View style={styles.logisticsItem}>
                    <Text style={styles.logisticsLabel}>{t.horario}</Text>
                    <Text style={styles.logisticsValue}>{tr(version.logistics_time)}</Text>
                  </View>
                )}
                {version.logistics_location && (
                  <View style={[styles.logisticsItem, { flex: 2 }]}>
                    <Text style={styles.logisticsLabel}>{t.local}</Text>
                    <Text style={styles.logisticsValue}>{tr(version.logistics_location)}</Text>
                  </View>
                )}
              </View>
            )}

            {version.notes_client && (
              <View style={{ marginBottom: 12 }}>{renderRichNotes(tr(version.notes_client))}</View>
            )}
          </View>
        )}

        {/* Proposta Financeira — sempre começa numa nova página */}
        <View break>
          <View wrap={false}>
            <Text style={styles.sectionTitle}>{t.tituloFinanceiro}</Text>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderCell, detalhado ? styles.colNameD : styles.colName]}>{t.colItem}</Text>
              <Text style={[styles.tableHeaderCell, detalhado ? styles.colDescD : styles.colDesc]}>{t.colDescricao}</Text>
              <Text style={[styles.tableHeaderCell, detalhado ? styles.colQtyD : styles.colQty]}>{t.colQtd}</Text>
              <Text style={[styles.tableHeaderCell, detalhado ? styles.colUnitD : styles.colUnit]}>{t.colUnid}</Text>
              {detalhado && <Text style={[styles.tableHeaderCell, styles.colValorD]}>{t.colValorUnit}</Text>}
              {detalhado && <Text style={[styles.tableHeaderCell, styles.colTotalD]}>{t.colTotal}</Text>}
            </View>
          </View>

        <View style={{ marginBottom: 12 }}>
          {groups.filter(g => (items || []).some(i => i.item_group === g)).map((group, groupIdx, activeGroups) => {
            const groupItems = (items || []).filter(i => i.item_group === group);
            const isLastGroup = groupIdx === activeGroups.length - 1;
            const groupSum = groupItems.reduce((sum, item) =>
              sum + item.unit_cost * markupMultiplier * item.quantity, 0);

            const renderItemRow = (item: BudgetItem, index: number) => {
              const valorUnitario = item.unit_cost * markupMultiplier;
              return (
                <View key={item.id} style={[styles.tableRow, index % 2 === 1 ? styles.tableRowEven : {}]} wrap={false}>
                  <Text style={[styles.tableCell, detalhado ? styles.colNameD : styles.colName]}>{tr(item.name)}</Text>
                  <Text style={[styles.tableCell, detalhado ? styles.colDescD : styles.colDesc, { color: '#888', fontSize: 7, lineHeight: 1.4 }]}>
                    {tr(item.description)}
                  </Text>
                  <Text style={[styles.tableCell, detalhado ? styles.colQtyD : styles.colQty]}>{item.quantity}</Text>
                  <Text style={[styles.tableCell, detalhado ? styles.colUnitD : styles.colUnit]}>{t.unidades[item.unit_label] ?? item.unit_label}</Text>
                  {detalhado && (
                    <Text style={[styles.tableCell, styles.colValorD]}>{fmt(valorUnitario)}</Text>
                  )}
                  {detalhado && (
                    <Text style={[styles.tableCell, styles.colTotalD, { fontWeight: 700 }]}>
                      {fmt(valorUnitario * item.quantity)}
                    </Text>
                  )}
                </View>
              );
            };

            return (
              /* wrap={false} mantém o grupo inteiro numa só página, evitando divisões no meio da categoria */
              <View key={group} wrap={false}>
                <View style={styles.groupHeader}>
                  <Text>{t.grupos[group]}</Text>
                </View>

                {groupItems.map((item, index) => renderItemRow(item, index))}

                <View style={styles.groupSubtotalRow}>
                  <Text style={styles.groupSubtotalText}>{t.subtotal} {t.grupos[group]}</Text>
                  <Text style={styles.groupSubtotalValue}>{fmt(groupSum)}</Text>
                </View>

                {isLastGroup && (
                  <View style={styles.totalContainer} wrap={false} minPresenceAhead={80}>
                    <Text style={styles.totalLabel}>{t.totalProjeto}</Text>
                    <Text style={styles.totalValue}>{fmt(financials.valorFinal)}</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
        </View>{/* fim: Proposta Financeira */}

      </Page>

      {/* PÁGINA DE CONDIÇÕES E ASSINATURAS */}
      <Page size="A4" style={styles.page}>
        {/* Cabeçalho Página 2 */}
        {cabecalho}

        <Text style={styles.sectionTitle}>{t.condicoesTitulo}</Text>
        <View style={styles.conditionsList}>
          {t.clausulas.map((c, ci) => (
            <Fragment key={ci}>
              <View style={styles.conditionSection}>
                <Text style={styles.conditionTitle}>{c.titulo}</Text>
                {c.itens.map((txt, ii) => (
                  <Text key={ii} style={styles.conditionText}>{txt.replace('{taxaRemarcacao}', () => taxaRemarcacao)}</Text>
                ))}
              </View>
              {/* O cronograma do fee mensal fica logo depois da cláusula 3 (Pagamento). */}
              {ci === 2 && feeMensal}
            </Fragment>
          ))}
        </View>

        <Text style={[styles.sectionTitle, { marginTop: 10 }]}>{t.termoTitulo}</Text>
        <View style={styles.signatureContainer}>
          <View style={styles.signatureBox}>
            <Text style={styles.signatureTitle}>{t.aprovadoPor}</Text>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>{clientDisplayName}</Text>
            <Text style={styles.signatureLabel}>{contact?.name || t.contatoFallback}</Text>
            <Text style={styles.signatureLabel}>{t.dataLinha}</Text>
          </View>
          <View style={styles.signatureBox}>
            <Text style={styles.signatureTitle}>{t.produtoraLumos}</Text>
            <View style={styles.signatureLine} />
            <Text style={[styles.signatureLabel, styles.signatureName]}>{userName || t.equipeFallback}</Text>
            <Text style={styles.signatureLabel}>{t.dataLinha}</Text>
          </View>
        </View>

        {/* Rodapé (Não fixed, apenas absoluto na base da página 2) */}
        <View style={styles.pageFooter}>
          <Text style={styles.footerText}>{nomenclatureHeader} · WWW.PRODUTORALUMOS.COM.BR</Text>
        </View>
      </Page>
    </Document>
  );
};
