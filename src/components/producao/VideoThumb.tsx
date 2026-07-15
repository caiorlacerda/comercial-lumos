import { useState } from 'react';
import { Play } from 'lucide-react';
import { clsx } from 'clsx';

/**
 * Thumbnail de um vídeo de revisão. `src` é o data URL salvo em
 * video_versions.thumb_url (capturado no navegador ao abrir a revisão). Sem thumb,
 * mostra um placeholder com ícone de play.
 */
export default function VideoThumb({
  src, className, iconSize = 'w-10 h-10',
}: {
  src?: string | null;
  className?: string;
  iconSize?: string;
}) {
  const [failed, setFailed] = useState(false);
  const show = src && !failed;

  return (
    <div className={clsx('relative overflow-hidden bg-gradient-to-br from-lumos-text-secondary/10 to-lumos-text-secondary/5', className)}>
      {show && (
        <img src={src!} alt="" loading="lazy" onError={() => setFailed(true)} className="absolute inset-0 w-full h-full object-cover" />
      )}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className={clsx('rounded-full flex items-center justify-center transition-colors', show ? 'bg-black/40 text-white backdrop-blur-sm' : 'text-lumos-text-secondary/40', iconSize)}>
          <Play className="w-1/2 h-1/2" fill="currentColor" />
        </div>
      </div>
    </div>
  );
}
