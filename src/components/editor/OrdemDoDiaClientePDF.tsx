import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import logo from '../../assets/Logotipo-Preto-Alpha.png';
import '@/lib/pdfFonts';

/**
 * O PDF da ordem do dia que o CLIENTE baixa no portal — peça própria, e não
 * o `OrdemDoDiaPDF` interno.
 *
 * O PDF interno desenha a call sheet inteira: equipe, equipamentos,
 * contatos, horário de chamada de cada pessoa, talentos, locações, clima.
 * Nenhum desses dados existe no portal do cliente — a RPC `portal_agenda`
 * (migração 2026093337) nunca manda isso pra lá, de propósito. Reaproveitar
 * o componente interno aqui seria abrir a porta pra um campo interno vazar
 * pro cliente por engano, hoje ou daqui a seis meses quando alguém mexer no
 * PDF interno sem saber que este arquivo existe. Por isso este componente só
 * aceita como entrada o que o portal já tem em mãos: nome da gravação, data,
 * horário (já formatado), local, e o objeto `ordem` que `portal_agenda`
 * devolve — só `ponto_encontro`, `cronograma` (hora + descrição) e
 * `nota_cliente`. Nada além disso deve ser adicionado às props sem revisar
 * de novo se o dado é mesmo público.
 */

interface OrdemClientePonto {
  nome: string | null;
  endereco: string | null;
}

interface OrdemClienteCronogramaItem {
  hora: string | null;
  descricao: string | null;
}

export interface OrdemDoDiaClientePDFProps {
  nome: string;
  data: string;
  horario: string | null;
  local: string | null;
  ordem: {
    ponto_encontro: OrdemClientePonto | null;
    cronograma: OrdemClienteCronogramaItem[] | null;
    nota_cliente: string | null;
  };
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    paddingBottom: 56,
    backgroundColor: '#FFFFFF',
    fontFamily: 'Work Sans',
    color: '#222222',
    fontSize: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  headerTag: {
    fontFamily: 'Poppins',
    fontWeight: 700,
    fontSize: 9,
    letterSpacing: 1,
    color: '#888888',
    textTransform: 'uppercase',
  },
  headerLine: {
    borderBottomWidth: 2,
    borderBottomColor: '#F5D87A',
    marginBottom: 22,
  },
  tituloGravacao: {
    fontFamily: 'Poppins',
    fontWeight: 700,
    fontSize: 20,
    color: '#1a1a1a',
    marginBottom: 4,
  },
  dataHorario: {
    fontSize: 12,
    color: '#444444',
    marginBottom: 22,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontFamily: 'Poppins',
    fontWeight: 700,
    fontSize: 9,
    color: '#888888',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: '#DDDDDD',
    paddingBottom: 4,
  },
  pontoNome: {
    fontFamily: 'Poppins',
    fontWeight: 700,
    fontSize: 12,
    color: '#1a1a1a',
    marginBottom: 2,
  },
  pontoEndereco: {
    fontSize: 10,
    color: '#444444',
    lineHeight: 1.4,
  },
  cronoRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: '#EEEEEE',
  },
  cronoHora: {
    width: 56,
    fontFamily: 'Poppins',
    fontWeight: 700,
    fontSize: 10,
    color: '#1a1a1a',
  },
  cronoDescricao: {
    flex: 1,
    fontSize: 10,
    color: '#222222',
    lineHeight: 1.4,
  },
  notaTexto: {
    fontSize: 10,
    color: '#222222',
    lineHeight: 1.5,
  },
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
    color: '#999999',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});

const formatDataExtenso = (dateStr: string): string => {
  try {
    const d = new Date(dateStr + (dateStr.length === 10 ? 'T00:00:00' : ''));
    return format(d, "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
  } catch {
    return dateStr;
  }
};

export const OrdemDoDiaClientePDF = ({ nome, data, horario, local, ordem }: OrdemDoDiaClientePDFProps) => {
  const ponto = ordem.ponto_encontro;
  const temPonto = !!(ponto && (ponto.nome?.trim() || ponto.endereco?.trim()));
  const cronograma = (ordem.cronograma || []).filter(m => m.hora?.trim() || m.descricao?.trim());
  const nota = ordem.nota_cliente?.trim() || '';
  const dataHorarioTexto = `${formatDataExtenso(data)}${horario ? ` · ${horario}` : ''}`;

  return (
    <Document title={`Ordem do Dia - ${nome}`}>
      <Page size="A4" style={styles.page}>
        {/* Cabeçalho */}
        <View style={styles.header}>
          <Image src={logo} style={{ width: 130 }} />
          <Text style={styles.headerTag}>Ordem do Dia</Text>
        </View>
        <View style={styles.headerLine} />

        {/* Nome da gravação, data e horário em destaque */}
        <Text style={styles.tituloGravacao}>{nome}</Text>
        <Text style={styles.dataHorario}>{dataHorarioTexto}</Text>

        {/* Local da gravação, quando o portal tem essa informação */}
        {local?.trim() && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Local</Text>
            <Text style={styles.pontoNome}>{local}</Text>
          </View>
        )}

        {/* Ponto de encontro, com endereço */}
        {temPonto && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Ponto de encontro</Text>
            {ponto?.nome?.trim() ? <Text style={styles.pontoNome}>{ponto.nome}</Text> : null}
            {ponto?.endereco?.trim() ? <Text style={styles.pontoEndereco}>{ponto.endereco}</Text> : null}
          </View>
        )}

        {/* Cronograma: hora e o que acontece */}
        {cronograma.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Como vai ser o dia</Text>
            {cronograma.map((m, i) => (
              <View key={i} style={styles.cronoRow}>
                <Text style={styles.cronoHora}>{m.hora?.slice(0, 5) || '—'}</Text>
                <Text style={styles.cronoDescricao}>{m.descricao || 'A combinar'}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Recado ao cliente */}
        {nota && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>O que você precisa providenciar</Text>
            <Text style={styles.notaTexto}>{nota}</Text>
          </View>
        )}

        {/* Rodapé */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>LUMOS · {nome.toUpperCase()}</Text>
          <Text style={styles.footerText}>WWW.PRODUTORALUMOS.COM.BR</Text>
        </View>
      </Page>
    </Document>
  );
};
