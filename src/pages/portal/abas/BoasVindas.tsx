import WelcomeDocPage from '../../welcome-doc/WelcomeDocPage';

export default function BoasVindas({ token, nome }: { token: string; nome: string }) {
  return (
    <main className="painel">
      <div className="folha">
        <WelcomeDocPage token={token} nomePessoa={nome || 'cliente'} />
      </div>
    </main>
  );
}
