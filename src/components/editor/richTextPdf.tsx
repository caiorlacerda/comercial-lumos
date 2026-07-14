import { Text, View, StyleSheet } from '@react-pdf/renderer';

// Renderiza o HTML do editor rich text (TipTap) para elementos do react-pdf.
// Suporta títulos (h1–h5), negrito/itálico/sublinhado/risco, listas, citação e
// divisória. Também aceita texto puro (conteúdo antigo) — vira um parágrafo.
// Compartilhado entre o orçamento (BudgetPDF) e a OS (ServiceOrderPDF) para que
// os dois formatem igual.

const richStyles = StyleSheet.create({
  p: { fontSize: 8, lineHeight: 1.5, color: '#333', textAlign: 'justify', marginBottom: 5 },
  h1: { fontFamily: 'Poppins', fontWeight: 700, fontSize: 13, color: '#1a1a1a', marginTop: 4, marginBottom: 4 },
  h2: { fontFamily: 'Poppins', fontWeight: 700, fontSize: 11, color: '#1a1a1a', marginTop: 4, marginBottom: 3 },
  h3: { fontFamily: 'Poppins', fontWeight: 700, fontSize: 9.5, color: '#1a1a1a', marginTop: 3, marginBottom: 3 },
  h4: { fontFamily: 'Poppins', fontWeight: 700, fontSize: 9, color: '#333', marginTop: 3, marginBottom: 2 },
  h5: { fontFamily: 'Poppins', fontWeight: 700, fontSize: 8.5, color: '#333', marginTop: 2, marginBottom: 2 },
  liRow: { flexDirection: 'row', marginBottom: 2 },
  liBullet: { fontSize: 8, color: '#333', width: 12 },
  liText: { fontSize: 8, lineHeight: 1.5, color: '#333', flex: 1 },
  quote: { fontSize: 8, fontStyle: 'italic', color: '#555', marginBottom: 5, paddingLeft: 6, borderLeftWidth: 2, borderLeftColor: '#EFC700' },
  hr: { borderBottomWidth: 1, borderBottomColor: '#e5e5e5', marginVertical: 5 },
});

function renderInline(node: Node, keyBase: string): any[] {
  const out: any[] = [];
  node.childNodes.forEach((child, i) => {
    const key = `${keyBase}-${i}`;
    if (child.nodeType === 3) { out.push(child.textContent); return; }
    if (child.nodeType !== 1) return;
    const el = child as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === 'br') { out.push('\n'); return; }
    const s: any = {};
    if (tag === 'strong' || tag === 'b') s.fontWeight = 700;
    if (tag === 'em' || tag === 'i') s.fontStyle = 'italic';
    if (tag === 'u') s.textDecoration = 'underline';
    if (tag === 's' || tag === 'del' || tag === 'strike') s.textDecoration = 'line-through';
    out.push(<Text key={key} style={s}>{renderInline(el, key)}</Text>);
  });
  return out;
}

export function renderRichNotes(html: string): any[] {
  if (!html) return [];
  // Sem tags HTML? Trata como texto puro (conteúdo antigo).
  if (!/<[a-z][\s\S]*>/i.test(html)) {
    return [<Text key="plain" style={richStyles.p}>{html}</Text>];
  }
  let body: HTMLElement;
  try {
    body = new DOMParser().parseFromString(html, 'text/html').body;
  } catch {
    return [<Text key="plain" style={richStyles.p}>{html}</Text>];
  }
  const blocks: any[] = [];
  body.childNodes.forEach((node, i) => {
    const key = `blk-${i}`;
    if (node.nodeType === 3) {
      const t = node.textContent?.trim();
      if (t) blocks.push(<Text key={key} style={richStyles.p}>{t}</Text>);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (/^h[1-5]$/.test(tag)) {
      blocks.push(<Text key={key} style={(richStyles as any)[tag]}>{renderInline(el, key)}</Text>);
    } else if (tag === 'ul' || tag === 'ol') {
      Array.from(el.children).forEach((li, j) => {
        blocks.push(
          <View key={`${key}-${j}`} style={richStyles.liRow}>
            <Text style={richStyles.liBullet}>{tag === 'ol' ? `${j + 1}.` : '•'}</Text>
            <Text style={richStyles.liText}>{renderInline(li, `${key}-${j}`)}</Text>
          </View>
        );
      });
    } else if (tag === 'blockquote') {
      blocks.push(<Text key={key} style={richStyles.quote}>{renderInline(el, key)}</Text>);
    } else if (tag === 'hr') {
      blocks.push(<View key={key} style={richStyles.hr} />);
    } else {
      blocks.push(<Text key={key} style={richStyles.p}>{renderInline(el, key)}</Text>);
    }
  });
  return blocks;
}
