import { useVisualNovo } from '@/lib/visualNovo';
import LoginNovo from '@/pages/LoginNovo';
import LoginClassico from '@/pages/LoginClassico';

/** Escolhe o login conforme o interruptor do visual novo (ver `lib/visualNovo.ts`). */
export default function Login() {
  const novo = useVisualNovo();
  return novo ? <LoginNovo /> : <LoginClassico />;
}
