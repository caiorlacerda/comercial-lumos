export default function ProgressBar({ feitos, total }: { feitos: number; total: number }) {
  if (!total) return null;
  const pct = Math.round((feitos / total) * 100);
  return (
    <div className="wd-progresso" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <span className="wd-progresso-legenda">Seu onboarding</span>
      <div className="wd-progresso-trilha">
        <div className="wd-progresso-luz" style={{ width: `${pct}%` }} />
      </div>
      <span className="wd-progresso-contagem"><b>{feitos}</b> de {total} itens</span>
    </div>
  );
}
