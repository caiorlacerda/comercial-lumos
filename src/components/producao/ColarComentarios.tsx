import { useMemo, useState } from 'react';
import { ClipboardPaste, Loader2 } from 'lucide-react';
import Modal from '@/components/common/Modal';
import { interpretarComentarios } from '@/lib/colarComentarios';
import { timecode } from '@/lib/reviewCanvas';

interface Props {
  fps: number;
  /** Duração do vídeo, pra avisar quando o tempo colado não existe nele. */
  duracaoMs: number;
  onConfirmar: (itens: { ms: number; texto: string }[]) => Promise<void>;
  onClose: () => void;
}

/**
 * Cola o feedback que veio de fora (e-mail, WhatsApp, documento) e vira
 * comentário com timecode.
 *
 * A tela mostra o que foi entendido ANTES de criar. Importar às cegas seria
 * pior que digitar na mão: erro em massa é mais difícil de achar do que erro
 * um a um.
 */
export default function ColarComentarios({ fps, duracaoMs, onConfirmar, onClose }: Props) {
  const [texto, setTexto] = useState('');
  const [salvando, setSalvando] = useState(false);

  const leitura = useMemo(() => interpretarComentarios(texto, fps), [texto, fps]);
  const foraDoVideo = duracaoMs > 0 ? leitura.comentarios.filter(c => c.ms > duracaoMs).length : 0;

  const confirmar = async () => {
    if (!leitura.comentarios.length || salvando) return;
    setSalvando(true);
    try { await onConfirmar(leitura.comentarios.map(c => ({ ms: c.ms, texto: c.texto }))); onClose(); }
    finally { setSalvando(false); }
  };

  return (
    <Modal isOpen onClose={onClose} title="Colar comentários" maxWidth="max-w-2xl">
      <div className="space-y-3">
        <p className="text-xs text-lumos-text-secondary leading-relaxed">
          Cole aqui o retorno que veio por e-mail ou WhatsApp. Cada linha que começa
          com um tempo vira um comentário no ponto certo do vídeo. Linha sem tempo
          continua o pedido de cima.
        </p>

        <textarea autoFocus value={texto} onChange={e => setTexto(e.target.value)}
          rows={7} placeholder={'00:15 trocar o texto da abertura\n1:20 - cortar essa parte\n2:03 o logo está torto'}
          className="input-lumos w-full text-xs resize-none py-2 leading-relaxed font-mono" />

        {texto.trim() && (
          <div className="rounded-lumos border border-lumos-border overflow-hidden">
            <div className="px-3 py-2 border-b border-lumos-border flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary">
                Vai criar {leitura.comentarios.length} {leitura.comentarios.length === 1 ? 'comentário' : 'comentários'}
              </span>
              {foraDoVideo > 0 && (
                <span className="text-[10px] font-bold text-amber-500">
                  {foraDoVideo} depois do fim do vídeo
                </span>
              )}
            </div>

            <div className="max-h-56 overflow-y-auto custom-scrollbar divide-y divide-lumos-border/50">
              {leitura.comentarios.map((c, i) => (
                <div key={i} className="px-3 py-2 flex gap-3">
                  <span className={`text-[11px] font-mono font-black flex-shrink-0 ${
                    duracaoMs > 0 && c.ms > duracaoMs ? 'text-amber-500' : 'text-lumos-yellow'}`}>
                    {timecode(c.ms, fps)}
                  </span>
                  <span className="text-[11.5px] text-lumos-text-primary leading-snug">{c.texto}</span>
                </div>
              ))}
              {!leitura.comentarios.length && (
                <p className="px-3 py-4 text-[11.5px] text-lumos-text-secondary italic">
                  Nenhuma linha começou com um tempo. Aceita 00:15, 1:20, 1:20:30, 00:00:15:12, 1'20" ou "aos 15s".
                </p>
              )}
            </div>

            {leitura.ignoradas.length > 0 && (
              <div className="px-3 py-2 border-t border-lumos-border bg-lumos-text-secondary/[0.03]">
                <p className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary/70 mb-1">
                  Fora, por não ter tempo ({leitura.ignoradas.length})
                </p>
                {leitura.ignoradas.slice(0, 3).map((l, i) => (
                  <p key={i} className="text-[11px] text-lumos-text-secondary truncate">{l}</p>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
          <button onClick={confirmar} disabled={!leitura.comentarios.length || salvando}
            className="btn-primary flex-1 disabled:opacity-50 flex items-center justify-center gap-2">
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardPaste className="w-4 h-4" />}
            Criar {leitura.comentarios.length || ''}
          </button>
        </div>
      </div>
    </Modal>
  );
}
