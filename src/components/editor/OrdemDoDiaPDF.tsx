import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import logo from '../../assets/Logotipo-Preto-Alpha.png';
import '@/lib/pdfFonts';
import type { OrdemDoDia } from '@/types/ordemDoDia';

const styles = StyleSheet.create({
  page: {
    padding: 40,
    paddingBottom: 60,
    backgroundColor: '#F5F5F3',
    fontFamily: 'Work Sans',
    color: '#222222',
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
  nomenclatureTag: {
    fontSize: 7,
    color: '#888888',
    fontFamily: 'Poppins',
    fontWeight: 400,
    marginBottom: 10,
    marginTop: 8,
  },
  // Bloco de identificação (Projeto / Código / Datas)
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
  },
  // Cabeçalhos de seção (fundo amarelo)
  sectionHeader: {
    backgroundColor: '#F5D87A',
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 6,
    marginTop: 14,
  },
  sectionHeaderText: {
    fontFamily: 'Poppins',
    fontWeight: 700,
    fontSize: 9,
    color: '#222222',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  // Texto livre dentro da seção (clima, etc)
  freeText: {
    fontSize: 8.5,
    color: '#222222',
    lineHeight: 1.5,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  // Linhas/células de tabela
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#DDDDDD',
    paddingVertical: 5,
    paddingHorizontal: 4,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#222222',
    paddingVertical: 4,
    paddingHorizontal: 4,
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  cell: {
    fontSize: 8.5,
    color: '#222222',
    paddingRight: 4,
  },
  cellHeader: {
    fontSize: 7,
    color: '#666',
    fontFamily: 'Poppins',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    paddingRight: 4,
  },
  cellBold: {
    fontSize: 8.5,
    color: '#222222',
    fontFamily: 'Poppins',
    fontWeight: 700,
    paddingRight: 4,
  },
  // Bloco simples (chave / valor) — Clima, Ponto de Encontro, Locação
  kvBlock: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  kvRow: {
    flexDirection: 'row',
    marginBottom: 3,
  },
  kvLabel: {
    width: '22%',
    fontSize: 7.5,
    color: '#666',
    fontFamily: 'Poppins',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  kvValue: {
    flex: 1,
    fontSize: 9,
    color: '#222222',
    lineHeight: 1.4,
  },
  // Equipe em duas colunas
  twoColRow: {
    flexDirection: 'row',
    gap: 12,
  },
  col: {
    flex: 1,
  },
  equipeItem: {
    flexDirection: 'row',
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: '#EEE',
  },
  equipeFuncao: {
    width: '45%',
    fontSize: 7.5,
    color: '#666',
    fontFamily: 'Poppins',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  equipeNome: {
    flex: 1,
    fontSize: 9,
    color: '#222222',
  },
  // Rodapé
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
    borderTopWidth: 0.5,
    borderTopColor: '#CCCCCC',
    paddingTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: {
    fontSize: 6.5,
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});

interface OrdemDoDiaPDFProps {
  ordem: OrdemDoDia;
}

const formatDateExtenso = (dateStr: string | null): string => {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr + (dateStr.length === 10 ? 'T00:00:00' : ''));
    return format(d, "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
  } catch {
    return dateStr;
  }
};

export const OrdemDoDiaPDF = ({ ordem }: OrdemDoDiaPDFProps) => {
  if (!ordem) return null;

  const dataEmissao = ordem.data_emissao
    ? formatDateExtenso(ordem.data_emissao.split('T')[0])
    : formatDateExtenso(new Date().toISOString().split('T')[0]);
  const dataProducao = formatDateExtenso(ordem.data_producao);
  const codigoStr = ordem.codigo?.startsWith('#') ? ordem.codigo : `#${ordem.codigo}`;
  const nomenclatureHeader = `${codigoStr} · LUMOS · ${ordem.titulo} · ORDEM DO DIA`;

  const secoes = ordem.secoes_ativas;
  const equipe = ordem.equipe || [];
  const equipeMid = Math.ceil(equipe.length / 2);
  const equipeColA = equipe.slice(0, equipeMid);
  const equipeColB = equipe.slice(equipeMid);

  return (
    <Document title={`OS_LUMOS_${(ordem.codigo || '').replace('#', '')}_OrdemDoDia`}>
      <Page size="A4" style={styles.page} wrap>
        {/* Cabeçalho */}
        <View style={styles.header} fixed>
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
        <View style={styles.headerLine} fixed />

        <Text style={styles.nomenclatureTag}>{nomenclatureHeader}</Text>

        {/* Bloco de identificação */}
        <View style={styles.idBlock}>
          <View style={styles.idRow}>
            <View style={styles.idLabelCol}><Text>Projeto</Text></View>
            <View style={styles.idValueCol}><Text style={{ fontWeight: 700 }}>{ordem.titulo}</Text></View>
            <View style={styles.idLabelCol}><Text>Código</Text></View>
            <View style={styles.idValueCol}><Text>{codigoStr}</Text></View>
          </View>
          <View style={[styles.idRow, { borderBottomWidth: 0 }]}>
            <View style={styles.idLabelCol}><Text>Produção</Text></View>
            <View style={styles.idValueCol}><Text style={{ fontWeight: 700 }}>{dataProducao}</Text></View>
            <View style={styles.idLabelCol}><Text>Emissão</Text></View>
            <View style={styles.idValueCol}><Text>{dataEmissao}</Text></View>
          </View>
        </View>

        {/* CLIMA */}
        {secoes.clima && ordem.clima && (
          <View wrap={false}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>Clima</Text>
            </View>
            <Text style={styles.freeText}>{ordem.clima}</Text>
          </View>
        )}

        {/* PONTO DE ENCONTRO */}
        {secoes.ponto_encontro && ordem.ponto_encontro && (ordem.ponto_encontro.nome || ordem.ponto_encontro.endereco) && (
          <View wrap={false}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>Ponto de Encontro</Text>
            </View>
            <View style={styles.kvBlock}>
              {ordem.ponto_encontro.nome ? (
                <View style={styles.kvRow}>
                  <Text style={styles.kvLabel}>Local</Text>
                  <Text style={styles.kvValue}>{ordem.ponto_encontro.nome}</Text>
                </View>
              ) : null}
              {ordem.ponto_encontro.endereco ? (
                <View style={styles.kvRow}>
                  <Text style={styles.kvLabel}>Endereço</Text>
                  <Text style={styles.kvValue}>{ordem.ponto_encontro.endereco}</Text>
                </View>
              ) : null}
            </View>
          </View>
        )}

        {/* LOCAÇÃO */}
        {secoes.locacao && ordem.locacao && (ordem.locacao.nome || ordem.locacao.endereco || ordem.locacao.observacoes) && (
          <View wrap={false}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>Locação</Text>
            </View>
            <View style={styles.kvBlock}>
              {ordem.locacao.nome ? (
                <View style={styles.kvRow}>
                  <Text style={styles.kvLabel}>Local</Text>
                  <Text style={styles.kvValue}>{ordem.locacao.nome}</Text>
                </View>
              ) : null}
              {ordem.locacao.endereco ? (
                <View style={styles.kvRow}>
                  <Text style={styles.kvLabel}>Endereço</Text>
                  <Text style={styles.kvValue}>{ordem.locacao.endereco}</Text>
                </View>
              ) : null}
              {ordem.locacao.observacoes ? (
                <View style={styles.kvRow}>
                  <Text style={styles.kvLabel}>Observações</Text>
                  <Text style={styles.kvValue}>{ordem.locacao.observacoes}</Text>
                </View>
              ) : null}
            </View>
          </View>
        )}

        {/* CONTATOS */}
        {secoes.contatos && (ordem.contatos?.length ?? 0) > 0 && (
          <View>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>Contatos</Text>
            </View>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.cellHeader, { width: '35%' }]}>Função / Empresa</Text>
              <Text style={[styles.cellHeader, { width: '40%' }]}>Nome</Text>
              <Text style={[styles.cellHeader, { width: '25%' }]}>Telefone</Text>
            </View>
            {(ordem.contatos || []).map((c, i) => (
              <View key={i} style={styles.tableRow} wrap={false}>
                <Text style={[styles.cell, { width: '35%' }]}>{c.funcao || '—'}</Text>
                <Text style={[styles.cell, { width: '40%' }]}>{c.nome || '—'}</Text>
                <Text style={[styles.cell, { width: '25%' }]}>{c.telefone || '—'}</Text>
              </View>
            ))}
          </View>
        )}

        {/* EQUIPE — duas colunas */}
        {secoes.equipe && equipe.length > 0 && (
          <View>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>Equipe</Text>
            </View>
            <View style={styles.twoColRow}>
              <View style={styles.col}>
                {equipeColA.map((m, i) => (
                  <View key={i} style={styles.equipeItem} wrap={false}>
                    <Text style={styles.equipeFuncao}>{m.funcao || '—'}</Text>
                    <Text style={styles.equipeNome}>{m.nome || '—'}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.col}>
                {equipeColB.map((m, i) => (
                  <View key={i} style={styles.equipeItem} wrap={false}>
                    <Text style={styles.equipeFuncao}>{m.funcao || '—'}</Text>
                    <Text style={styles.equipeNome}>{m.nome || '—'}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}

        {/* PLANO DE AÇÃO */}
        {secoes.plano_acao && (ordem.plano_acao?.length ?? 0) > 0 && (
          <View>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>Plano de Ação</Text>
            </View>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.cellHeader, { width: '15%' }]}>Horário</Text>
              <Text style={[styles.cellHeader, { width: '60%' }]}>Atividade</Text>
              <Text style={[styles.cellHeader, { width: '25%' }]}>Responsável</Text>
            </View>
            {(ordem.plano_acao || []).map((a, i) => {
              const horario = a.fim ? `${a.inicio} – ${a.fim}` : a.inicio;
              const Cell = a.destaque ? styles.cellBold : styles.cell;
              return (
                <View key={i} style={styles.tableRow} wrap={false}>
                  <Text style={[Cell, { width: '15%' }]}>{horario || '—'}</Text>
                  <Text style={[Cell, { width: '60%' }]}>{a.descricao || '—'}</Text>
                  <Text style={[Cell, { width: '25%' }]}>{a.responsavel || '—'}</Text>
                </View>
              );
            })}
          </View>
        )}

        {/* TALENTOS */}
        {secoes.talentos && (ordem.talentos?.length ?? 0) > 0 && (
          <View>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>Lista de Talentos</Text>
            </View>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.cellHeader, { width: '22%' }]}>Nome</Text>
              <Text style={[styles.cellHeader, { width: '18%' }]}>Função</Text>
              <Text style={[styles.cellHeader, { width: '12%' }]}>Chegada</Text>
              <Text style={[styles.cellHeader, { width: '12%' }]}>Gravação</Text>
              <Text style={[styles.cellHeader, { width: '36%' }]}>Observações</Text>
            </View>
            {(ordem.talentos || []).map((t, i) => (
              <View key={i} style={styles.tableRow} wrap={false}>
                <Text style={[styles.cell, { width: '22%' }]}>{t.nome || '—'}</Text>
                <Text style={[styles.cell, { width: '18%' }]}>{t.funcao || '—'}</Text>
                <Text style={[styles.cell, { width: '12%' }]}>{t.horario_chegada || '—'}</Text>
                <Text style={[styles.cell, { width: '12%' }]}>{t.horario_gravacao || '—'}</Text>
                <Text style={[styles.cell, { width: '36%' }]}>{t.obs || '—'}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Rodapé */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>{nomenclatureHeader}</Text>
          <Text style={styles.footerText}>WWW.PRODUTORALUMOS.COM.BR</Text>
        </View>
      </Page>
    </Document>
  );
};
