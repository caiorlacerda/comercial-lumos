import { useMemo } from 'react';
import Select from '@/components/ui/Select';
import { opcoesDeMes } from '@/lib/filtroMes';

interface Props {
  /** "AAAA-MM", ou '' para todos os meses. */
  value: string;
  onChange: (mes: string) => void;
  /** Mês de cada item da lista (use `chaveMes`); os meses do seletor saem daqui. */
  chaves: Iterable<string | null>;
  className?: string;
  ariaLabel?: string;
}

/** Seletor de mês dos filtros de lista: "Todos os meses" + os meses que existem nos dados. */
export default function SeletorMes({ value, onChange, chaves, className = 'input-lumos h-9 w-full text-xs', ariaLabel = 'Filtrar por mês' }: Props) {
  const opcoes = useMemo(() => opcoesDeMes(chaves, value), [chaves, value]);
  return <Select value={value} onChange={onChange} options={opcoes} className={className} ariaLabel={ariaLabel} />;
}
