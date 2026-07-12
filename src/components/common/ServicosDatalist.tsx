import { SERVICOS_CATALOGO } from '@/lib/servicosCatalog';

// <datalist> com o catálogo padrão de serviços. Renderize uma vez no formulário
// e use list="servicos-catalogo" nos inputs de tipo de serviço para autocomplete.
export default function ServicosDatalist() {
  return (
    <datalist id="servicos-catalogo">
      {SERVICOS_CATALOGO.map(s => <option key={s} value={s} />)}
    </datalist>
  );
}
