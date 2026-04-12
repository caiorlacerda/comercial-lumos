import { Document, Page, Text, View, StyleSheet, Font, Image } from '@react-pdf/renderer';
import { BudgetItem, BudgetVersion } from '@/utils/financials';
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
    backgroundColor: '#F5F5F3', 
    fontFamily: 'Work Sans',
    color: '#1a1a1a',
    fontSize: 8,
    position: 'relative',
  },
  
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
    borderBottomColor: '#F5D87A', 
    marginBottom: 8,
  },

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
  
  nomenclatureTag: {
    fontSize: 7,
    color: '#888888',
    fontFamily: 'Poppins',
    fontWeight: 400,
    marginBottom: 10,
    marginTop: 8,
  },

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

  table: {
    marginTop: 10,
    marginBottom: 12,
  },
  groupHeader: {
    backgroundColor: '#F5D87A', 
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
  
  colName: { width: '30%' },
  colDesc: { width: '35%' },
  colQty: { width: '15%', textAlign: 'center' },
  colUnit: { width: '20%', textAlign: 'center' },

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

interface ServiceOrderPDFProps {
  budget: any;
  version: BudgetVersion;
  contact?: any;
  items: BudgetItem[];
}

export const ServiceOrderPDF = ({ budget, version, contact, items }: ServiceOrderPDFProps) => {
  if (!budget || !version) return null;

  const dateStr = format(new Date(), "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
  
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

  const clientDisplayName = budget.clients?.agency_name 
    ? `${budget.clients.agency_name} + ${budget.clients.name}`
    : (budget.clients?.name || 'Cliente');
    
  const formattedCode = formatBudgetCode(budget.code);
  const nomenclatureHeader = `${formattedCode} | Lumos + ${clientDisplayName} | ${budget.project_name}`;

  return (
    <Document title={`OS_LUMOS_${formattedCode.replace('#', '')}`}>
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

        {/* Nomenclatura */}
        <Text style={styles.nomenclatureTag}>{nomenclatureHeader}</Text>

        {/* Bloco de Identificação */}
        <View style={styles.idBlock}>
          <View style={styles.idRow}>
            <View style={styles.idLabelCol}><Text>Projeto</Text></View>
            <View style={styles.idValueCol}><Text style={{ fontWeight: 700 }}>{budget.project_name}</Text></View>
            <View style={[styles.idMetaCol, { borderLeftWidth: 0.5, borderLeftColor: '#dcdcdc' }]}>
               <Text style={styles.idDate}>Emissão OS: {dateStr}</Text>
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
        {version.notes_client && (
          <View>
            <Text style={styles.sectionTitle}>Escopo e Briefing</Text>
            <Text style={styles.briefingText}>{version.notes_client}</Text>
          </View>
        )}

        {/* Itens da Ordem de Serviço */}
        <Text style={styles.sectionTitle}>ORDEM DE SERVIÇO</Text>
        
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, styles.colName]}>Item / Serviço</Text>
            <Text style={[styles.tableHeaderCell, styles.colDesc]}>Descrição</Text>
            <Text style={[styles.tableHeaderCell, styles.colQty]}>Qtd</Text>
            <Text style={[styles.tableHeaderCell, styles.colUnit]}>Unid.</Text>
          </View>

          {groups.map(group => {
            const groupItems = (items || []).filter(i => i.item_group === group);
            if (groupItems.length === 0) return null;

            return (
              <View key={group} wrap={false}>
                <View style={styles.groupHeader}>
                  <Text>{groupLabels[group]}</Text>
                </View>

                {groupItems.map((item, index) => (
                  <View key={item.id} style={[styles.tableRow, index % 2 === 1 ? styles.tableRowEven : {}]} wrap={false}>
                    <Text style={[styles.tableCell, styles.colName]}>{item.name}</Text>
                    <Text style={[styles.tableCell, styles.colDesc, { color: '#888', fontSize: 7, lineHeight: 1.4 }]}>
                      {item.description || ''}
                    </Text>
                    <Text style={[styles.tableCell, styles.colQty]}>{item.quantity}</Text>
                    <Text style={[styles.tableCell, styles.colUnit]}>{item.unit_label}</Text>
                  </View>
                ))}
              </View>
            );
          })}
        </View>

        {/* Rodapé */}
        <View style={styles.pageFooter}>
          <Text style={styles.footerText}>{nomenclatureHeader} · WWW.PRODUTORALUMOS.COM.BR</Text>
        </View>
      </Page>
    </Document>
  );
};
