import { useEffect, useMemo, useRef } from 'react';
import * as Y from 'yjs';
import type { Editor } from '@tiptap/core';
import { useEditor } from '@tiptap/react';
import Collaboration, { isChangeOrigin } from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { clsx } from 'clsx';
import { EditorVisual, extensoesDoEditor, type MentionPage } from '@/components/common/RichTextEditor';
import { ProvedorYjsSupabase } from '@/lib/colaboracao/yjsSupabase';
import { useTextoColaborativo } from '@/lib/colaboracao/useTextoColaborativo';
import { EsqueletoLinhas } from '@/components/ui/Esqueleto';

/**
 * Editor de texto COLABORATIVO (estilo Google Docs): várias pessoas digitam no mesmo texto ao mesmo tempo,
 * cada uma com o cursor colorido e o nome visíveis para as outras. O texto é um documento Yjs sincronizado
 * pelo Supabase (ver `lib/colaboracao/yjsSupabase.ts`). O HTML continua sendo gravado na coluna de origem
 * (via `espelho`) para PDF, busca e o resto do app.
 */
interface Props {
  /** Identifica o texto, ex.: "orcamento-briefing:<id>". Uma chave = um texto compartilhado. */
  chave: string;
  /** Texto que já existe na coluna de origem. Só serve para criar o estado inicial na primeira vez. */
  htmlInicial: string;
  usuario: { nome: string; cor: string };
  /** Grava o HTML na coluna de origem (briefing, descrição...). Chamado depois de cada gravação do estado. */
  espelho?: (html: string) => void | Promise<void>;
  /** A pessoa local mexeu no texto. */
  onChange?: (html: string) => void;
  /** Outra pessoa mexeu no texto (para o pai manter a cópia em dia, sem marcar "alterado" aqui). */
  onChangeRemoto?: (html: string) => void;
  /** Mostrado no lugar do editor em conjunto quando ele não está disponível (ex.: o SQL ainda não foi rodado). */
  alternativa?: React.ReactNode;
  /** Entrega o editor quando fica pronto (e null ao sair): serve para ações de fora, como carregar um template. */
  onEditorPronto?: (editor: Editor | null) => void;
  editable?: boolean;
  className?: string;
  minHeight?: number;
  mentionPages?: MentionPage[];
}

export default function RichTextEditorColaborativo(props: Props) {
  const { chave, htmlInicial, usuario } = props;
  const { estado, doc, provedor } = useTextoColaborativo({
    chave, htmlInicial, ativo: true, usuario,
    extensoesParaSemear: () => extensoesDoEditor(undefined, true),
  });

  if (estado === 'falhou') {
    if (props.alternativa) return <>{props.alternativa}</>;
    return (
      <div className={clsx('rounded-lumos border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-lumos-text-primary', props.className)}>
        Não foi possível abrir a edição em conjunto deste texto. Recarregue a página; se continuar, avise a administração.
      </div>
    );
  }
  if (estado !== 'pronto' || !doc || !provedor) {
    return (
      <div className={clsx('rounded-lumos border border-lumos-border bg-lumos-surface p-4', props.className)} style={{ minHeight: props.minHeight }}>
        <EsqueletoLinhas n={5} />
      </div>
    );
  }
  return <CorpoColaborativo key={chave} {...props} doc={doc} provedor={provedor} />;
}

function CorpoColaborativo({ doc, provedor, usuario, espelho, onChange, onChangeRemoto, onEditorPronto, editable = true, className, minHeight = 160, mentionPages }:
  Props & { doc: Y.Doc; provedor: ProvedorYjsSupabase }) {
  const pagesRef = useRef<MentionPage[]>(mentionPages || []);
  useEffect(() => { pagesRef.current = mentionPages || []; }, [mentionPages]);
  const cbs = useRef({ onChange, onChangeRemoto, espelho, onEditorPronto });
  cbs.current = { onChange, onChangeRemoto, espelho, onEditorPronto };

  const extensoes = useMemo(() => [
    ...extensoesDoEditor(mentionPages ? () => pagesRef.current : undefined, true),
    Collaboration.configure({ document: doc }),
    CollaborationCaret.configure({ provider: provedor, user: usuario }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [doc, provedor]);

  const editor = useEditor({
    editable,
    immediatelyRender: false,
    extensions: extensoes,
    onUpdate: ({ editor, transaction }) => {
      const html = editor.getHTML();
      if (isChangeOrigin(transaction)) cbs.current.onChangeRemoto?.(html);
      else cbs.current.onChange?.(html);
    },
    editorProps: { attributes: { class: 'ProseMirror focus:outline-none' } },
  }, [extensoes]);

  useEffect(() => { editor?.setEditable(editable); }, [editable, editor]);

  // Depois de cada gravação do estado, o HTML também vai para a coluna de origem.
  useEffect(() => {
    if (!editor) return;
    provedor.aoGravar = () => cbs.current.espelho?.(editor.getHTML());
    return () => { provedor.aoGravar = null; };
  }, [editor, provedor]);

  // Avisa o pai do texto atual assim que o documento carrega (ele guarda uma cópia do HTML) e entrega o editor.
  useEffect(() => {
    if (!editor) return;
    cbs.current.onChangeRemoto?.(editor.getHTML());
    cbs.current.onEditorPronto?.(editor);
    return () => cbs.current.onEditorPronto?.(null);
  }, [editor]);

  if (!editor) return null;
  return <EditorVisual editor={editor} editable={editable} className={className} minHeight={minHeight} />;
}
