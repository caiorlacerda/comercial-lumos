import { lazy, Suspense } from 'react';
import { useVisualNovo } from '@/lib/visualNovo';

const HomeNova = lazy(() => import('@/pages/HomeNova'));
const HomeClassica = lazy(() => import('@/pages/HomeClassica'));

/** Escolhe a Home conforme o interruptor do visual novo (ver `lib/visualNovo.ts`). */
export default function Home() {
  const novo = useVisualNovo();
  return (
    <Suspense fallback={null}>
      {novo ? <HomeNova /> : <HomeClassica />}
    </Suspense>
  );
}
