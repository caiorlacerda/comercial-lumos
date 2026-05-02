import { Document, Page, Text, View, StyleSheet, Font, Image } from '@react-pdf/renderer';
import { BudgetItem, BudgetVersion, VersionFinancials, formatCurrency } from '@/utils/financials';
import { formatBudgetCode } from '@/utils/formatters';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import logo from '../../assets/Logotipo-Preto-Alpha.png';

// 1. REGISTRO DE FONTES
Font.register({
  family: 'Poppins',
  fonts: [
    { src: 'https://cdn.jsdelivr.net/fontsource/fonts/poppins@latest/latin-400-normal.ttf' },
    { src: 'https://cdn.jsdelivr.net/fontsource/fonts/poppins@latest/latin-600-normal.ttf', fontWeight: 600 },
    { src: 'https://cdn.jsdelivr.net/fontsource/fonts/poppins@latest/latin-700-normal.ttf', fontWeight: 700 },
  ],
});

Font.register({
  family: 'Work Sans',
  fonts: [
    { src: 'https://cdn.jsdelivr.net/fontsource/fonts/work-sans@latest/latin-400-normal.ttf' },
    { src: 'https://cdn.jsdelivr.net/fontsource/fonts/work-sans@latest/latin-600-normal.ttf', fontWeight: 600 },
    { src: 'https://cdn.jsdelivr.net/fontsource/fonts/work-sans@latest/latin-700-normal.ttf', fontWeight: 700 },
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

// 3. COMPONENTE
interface BudgetPDFProps {
  budget: any;
  version: BudgetVersion;
  contact?: any;
  items: BudgetItem[];
  financials: VersionFinancials;
  userName?: string;
}

export const BudgetPDF = ({ budget, version, contact, items, financials, userName }: BudgetPDFProps) => {
  if (!budget || !version || !financials) return null;

  const dateStr = format(new Date(), "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
  const markupMultiplier = financials.valorFinal / (financials.totalCusto || 1);
  
  // Format Category to Title Case
  const categoryFormatted = budget.category 
    ? budget.category.charAt(0).toUpperCase() + budget.category.slice(1).toLowerCase()
    : '—';

  const groupLabels: Record<string, string> = {
    'equipe': 'Equipe',
    'equipamentos': 'Equipamentos',
    'producao': 'Produção',
    'edicao': 'Pós-produção'
  };

  const groups = ['equipe', 'equipamentos', 'producao', 'edicao'] as const;

  // Novo padrão de nomenclatura: [CODE] | Lumos + [AGÊNCIA] [CLIENTE] | [NOME DO PROJETO]
  const clientDisplayName = budget.clients?.agency_name 
    ? `${budget.clients.agency_name} + ${budget.clients.name}`
    : (budget.clients?.name || 'Cliente');
    
  const formattedCode = formatBudgetCode(budget.code);
  const nomenclatureHeader = `${formattedCode} | Lumos + ${clientDisplayName} | ${budget.project_name}`;
  const proposalTag = nomenclatureHeader;

  return (
    <Document title={`PROPOSTA_LUMOS_${formattedCode.replace('#', '')}`}>
      {/* PÁGINA 1: PROPOSTA FINANCEIRA */}
      <Page size="A4" style={styles.page}>
        {/* Cabeçalho */}
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

        {/* Nomenclatura acima do bloco */}
        <Text style={styles.nomenclatureTag}>{proposalTag}</Text>

        {/* Bloco de Identificação */}
        <View style={styles.idBlock}>
          <View style={styles.idRow}>
            <View style={styles.idLabelCol}><Text>Projeto</Text></View>
            <View style={styles.idValueCol}><Text style={{ fontWeight: 700 }}>{budget.project_name}</Text></View>
            <View style={[styles.idMetaCol, { borderLeftWidth: 0.5, borderLeftColor: '#dcdcdc' }]}>
               <Text style={styles.idDate}>Emissão: {dateStr}</Text>
            </View>
          </View>
          <View style={styles.idRow}>
            <View style={styles.idLabelCol}><Text>Cliente</Text></View>
            <View style={styles.idValueCol}><Text>{clientDisplayName}</Text></View>
            <View style={[styles.idLabelCol, { borderLeftWidth: 0.5, borderLeftColor: '#dcdcdc' }]}><Text>Categoria</Text></View>
            <View style={styles.idValueCol}><Text>{categoryFormatted}</Text></View>
          </View>
          <View style={[styles.idRow, { borderBottomWidth: 0 }]}>
            <View style={styles.idLabelCol}><Text>Contato</Text></View>
            <View style={{ width: '85%', padding: 4 }}>
              <Text>{contact?.name || '—'}  ·  {contact?.email || '—'}</Text>
            </View>
          </View>
        </View>

        {/* Escopo e Briefing */}
        {(version.notes_client || version.logistics_date || version.logistics_time || version.logistics_location) && (
          <View>
            <Text style={styles.sectionTitle}>Escopo e Briefing</Text>
            
            {/* Bloco de Logística se preenchido */}
            {(version.logistics_date || version.logistics_time || version.logistics_location) && (
              <View style={styles.logisticsBlock}>
                {version.logistics_date && (
                  <View style={styles.logisticsItem}>
                    <Text style={styles.logisticsLabel}>Data(s)</Text>
                    <Text style={styles.logisticsValue}>{version.logistics_date}</Text>
                  </View>
                )}
                {version.logistics_time && (
                  <View style={styles.logisticsItem}>
                    <Text style={styles.logisticsLabel}>Horário</Text>
                    <Text style={styles.logisticsValue}>{version.logistics_time}</Text>
                  </View>
                )}
                {version.logistics_location && (
                  <View style={[styles.logisticsItem, { flex: 2 }]}>
                    <Text style={styles.logisticsLabel}>Local / Endereço</Text>
                    <Text style={styles.logisticsValue}>{version.logistics_location}</Text>
                  </View>
                )}
              </View>
            )}

            {version.notes_client && (
              <Text style={styles.briefingText}>{version.notes_client}</Text>
            )}
          </View>
        )}

        {/* Proposta Financeira — sempre começa numa nova página */}
        <View break>
          <View wrap={false}>
            <Text style={styles.sectionTitle}>Proposta Financeira Detalhada</Text>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderCell, styles.colName]}>Item / Serviço</Text>
              <Text style={[styles.tableHeaderCell, styles.colDesc]}>Descrição</Text>
              <Text style={[styles.tableHeaderCell, styles.colQty]}>Qtd</Text>
              <Text style={[styles.tableHeaderCell, styles.colUnit]}>Unid.</Text>
            </View>
          </View>

        <View style={{ marginBottom: 12 }}>
          {groups.filter(g => (items || []).some(i => i.item_group === g)).map((group, groupIdx, activeGroups) => {
            const groupItems = (items || []).filter(i => i.item_group === group);
            const isLastGroup = groupIdx === activeGroups.length - 1;
            const groupSum = groupItems.reduce((sum, item) =>
              sum + item.unit_cost * markupMultiplier * item.quantity, 0);

            const renderItemRow = (item: BudgetItem, index: number) => (
              <View key={item.id} style={[styles.tableRow, index % 2 === 1 ? styles.tableRowEven : {}]} wrap={false}>
                <Text style={[styles.tableCell, styles.colName]}>{item.name}</Text>
                <Text style={[styles.tableCell, styles.colDesc, { color: '#888', fontSize: 7, lineHeight: 1.4 }]}>
                  {item.description || ''}
                </Text>
                <Text style={[styles.tableCell, styles.colQty]}>{item.quantity}</Text>
                <Text style={[styles.tableCell, styles.colUnit]}>{item.unit_label}</Text>
              </View>
            );

            return (
              /* wrap={false} mantém o grupo inteiro numa só página, evitando divisões no meio da categoria */
              <View key={group} wrap={false}>
                <View style={styles.groupHeader}>
                  <Text>{groupLabels[group]}</Text>
                </View>

                {groupItems.map((item, index) => renderItemRow(item, index))}

                <View style={styles.groupSubtotalRow}>
                  <Text style={styles.groupSubtotalText}>Subtotal {groupLabels[group]}</Text>
                  <Text style={styles.groupSubtotalValue}>{formatCurrency(groupSum)}</Text>
                </View>

                {isLastGroup && (
                  <View style={styles.totalContainer} wrap={false} minPresenceAhead={80}>
                    <Text style={styles.totalLabel}>Investimento Total do Projeto</Text>
                    <Text style={styles.totalValue}>{formatCurrency(financials.valorFinal)}</Text>
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

        <Text style={styles.sectionTitle}>CONDIÇÕES GERAIS</Text>
        <View style={styles.conditionsList}>
          {/* Item 1 */}
          <View style={styles.conditionSection}>
            <Text style={styles.conditionTitle}>1. Prazos e alterações</Text>
            <Text style={styles.conditionText}>1.1. Esta Proposta Comercial terá validade por 7 dias corridos, a partir da celebração do contrato entre as partes. Após este período, os investimentos estarão sujeitos a alterações.</Text>
            <Text style={styles.conditionText}>1.2. Eventuais alterações nas especificações dos trabalhos a serem realizados podem alterar o valor desta Proposta Comercial.</Text>
          </View>

          {/* Item 2 */}
          <View style={styles.conditionSection}>
            <Text style={styles.conditionTitle}>2. Cancelamento e rescisão</Text>
            <Text style={styles.conditionText}>2.1. Aprovada esta Proposta Comercial, em qualquer hipótese de cancelamento da prestação dos serviços, por parte do CLIENTE, será devida multa, em favor da LUMOS, em valor correspondente a 70% (setenta por cento) do valor total devido pelo CLIENTE, sem prejuízo do pagamento de todas as despesas já realizadas pela LUMOS, na execução dos serviços objeto da presente Proposta Comercial.</Text>
            <Text style={styles.conditionText}>2.2. Para quaisquer finalidades que se façam necessárias, a presente Proposta Comercial, considerar-se-á aprovada pelo CLIENTE, em qualquer hipótese de manifestação deste, concordando com seus termos e condições, seja por concordância manifestada por e-mail ou outros meios, tais como mas não limitados a aplicativos de troca de mensagens, mensagens de texto, etc., seja por manifestação tácita da vontade do CLIENTE, no sentido deste ter ciência do início do cumprimento das obrigações constantes da Proposta Comercial, pela LUMOS, sem que se manifeste em contrário.</Text>
          </View>

          {/* Item 3 */}
          <View style={styles.conditionSection}>
            <Text style={styles.conditionTitle}>3. Pagamento</Text>
            <Text style={styles.conditionText}>3.1. O pagamento deverá ocorrer de acordo com prazo de pagamento combinado entre o CLIENTE e a LUMOS no ato do aceite da presente Proposta Comercial, dentro das opções disponíveis nesta.</Text>
            <Text style={styles.conditionText}>3.2. O atraso no pagamento sujeitará o CLIENTE à multa de 10% (dez por cento) e juros de 1% a.m. sobre o valor do débito.</Text>
          </View>

          {/* Item 4 */}
          <View style={styles.conditionSection}>
            <Text style={styles.conditionTitle}>4. Taxa de Remarcação</Text>
            <Text style={styles.conditionText}>4.1. Caso o CLIENTE altere a data prevista para a execução do serviço, sem respeitar o prazo máximo de 48 horas de antecedência, será cobrada uma taxa de remarcação no valor mínimo de R$2.000,00 ou 20% do valor total do projeto.</Text>
          </View>

          {/* Item 5 */}
          <View style={styles.conditionSection}>
            <Text style={styles.conditionTitle}>5. Direitos autorais e uso</Text>
            <Text style={styles.conditionText}>5.1. Todo o material produzido pela LUMOS permanece de propriedade desta até a quitação integral do valor contratado.</Text>
            <Text style={styles.conditionText}>5.2. A cessão de direitos de uso do material produzido está limitada ao território e período de veiculação descritos nesta Proposta.</Text>
          </View>

          {/* Item 6 */}
          <View style={styles.conditionSection}>
            <Text style={styles.conditionTitle}>6. Créditos</Text>
            <Text style={styles.conditionText}>6.1. A LUMOS reserva-se o direito de utilizar o material produzido em seu portfólio e materiais de divulgação, salvo expressa proibição do CLIENTE formalizada por escrito.</Text>
          </View>

          {/* Item 7 */}
          <View style={styles.conditionSection}>
            <Text style={styles.conditionTitle}>7. Responsabilidades</Text>
            <Text style={styles.conditionText}>7.1. A LUMOS não se responsabiliza por atrasos ou impedimentos causados por fatores externos ao seu controle, como condições climáticas, restrições de locação ou atrasos por parte do CLIENTE na entrega de materiais necessários à produção.</Text>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { marginTop: 10 }]}>Termo de Aceite e Aprovação</Text>
        <View style={styles.signatureContainer}>
          <View style={styles.signatureBox}>
            <Text style={styles.signatureTitle}>Aprovado por:</Text>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>{clientDisplayName}</Text>
            <Text style={styles.signatureLabel}>{contact?.name || 'NOME DO RESPONSÁVEL'}</Text>
            <Text style={styles.signatureLabel}>DATA: ____/____/____</Text>
          </View>
          <View style={styles.signatureBox}>
            <Text style={styles.signatureTitle}>Produtora Lumos</Text>
            <View style={styles.signatureLine} />
            <Text style={[styles.signatureLabel, styles.signatureName]}>{userName || 'Equipe de Produção'}</Text>
            <Text style={styles.signatureLabel}>DATA: ____/____/____</Text>
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
