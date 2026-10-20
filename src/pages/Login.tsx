import { useVisualNovoExplicito } from '@/lib/visualNovo';
import LoginNovo from '@/pages/LoginNovo';
import LoginClassico from '@/pages/LoginClassico';

/** Login: o visual novo só aparece para quem ligou de propósito; o padrão segue o login clássico (ver `lib/visualNovo.ts`). */
export default function Login() {
  const novo = useVisualNovoExplicito();
  return novo ? <LoginNovo /> : <LoginClassico />;
}
