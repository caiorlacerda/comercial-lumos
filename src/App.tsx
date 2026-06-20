import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import throttle from 'lodash/throttle';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Clients from '@/pages/Clients';
import Catalog from '@/pages/Catalog';
import Budgets from '@/pages/Budgets';
import Settings from '@/pages/Settings';
import Templates from '@/pages/Templates';
import BudgetEditorPage from '@/pages/BudgetEditorPage';
import Sidebar from '@/components/layout/Sidebar';
import ClientProfile from '@/pages/ClientProfile';

import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { PermissionGuard } from '@/components/auth/PermissionGuard';
import { LayoutProvider } from '@/context/LayoutContext';

// Novas Páginas Financeiras
import UsersPage from '@/pages/Users';
import AuditLog from '@/pages/AuditLog';
import AprovacaoPublica from '@/pages/AprovacaoPublica';
import FinanceiroDashboard from '@/pages/FinanceiroDashboard';
import ContasPagar from '@/pages/ContasPagar';
import ContasReceber from '@/pages/ContasReceber';
import Reembolso from '@/pages/Reembolso';
import CustosProjeto from '@/pages/CustosProjeto';
import CustosProjetoDetalhe from '@/pages/CustosProjetoDetalhe';
import FluxoDeCaixa from '@/pages/FluxoDeCaixa';
import CustosFixos from '@/pages/CustosFixos';
import FinanceiroConfig from '@/pages/FinanceiroConfig';
import FinanceiroRelatorios from '@/pages/FinanceiroRelatorios';
import OrdensDoDia from '@/pages/OrdensDoDia';
import OrdemDoDiaEditor from '@/pages/OrdemDoDiaEditor';
import Fornecedores from '@/pages/Fornecedores';
import FornecedorEditor from '@/pages/FornecedorEditor';
import Equipe from '@/pages/Equipe';
import ProducaoDashboard from '@/pages/ProducaoDashboard';
import CadastroFornecedorPublico from '@/pages/CadastroFornecedorPublico';

const TIMEOUT_WARNING_MS = 5 * 60 * 1000; // warn 5 min before expiry

function AuthWrapper({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, profileChecked, error, signOut } = useAuth();
  const lastActivityRef = useRef<number>(Date.now());
  const [showTimeoutWarning, setShowTimeoutWarning] = useState(false);

  useEffect(() => {
    if (!user) return;

    const STORAGE_KEY = 'lumos_last_activity';
    const TIMEOUT_MS = 3 * 60 * 60 * 1000; // 3 hours
    const CHECK_INTERVAL = 60 * 1000; // check every minute

    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      lastActivityRef.current = parseInt(stored, 10);
    } else {
      localStorage.setItem(STORAGE_KEY, Date.now().toString());
    }

    const updateActivity = throttle(() => {
      const now = Date.now();
      lastActivityRef.current = now;
      localStorage.setItem(STORAGE_KEY, now.toString());
      setShowTimeoutWarning(false);
    }, 60000);

    const checkInactivity = () => {
      const storedActivity = localStorage.getItem(STORAGE_KEY);
      const lastActivity = storedActivity ? parseInt(storedActivity, 10) : lastActivityRef.current;
      const idle = Date.now() - lastActivity;

      if (idle > TIMEOUT_MS) {
        signOut();
        window.location.href = '/login?timeout=true';
      } else if (idle > TIMEOUT_MS - TIMEOUT_WARNING_MS) {
        setShowTimeoutWarning(true);
      } else {
        setShowTimeoutWarning(false);
      }
    };

    window.addEventListener('mousemove', updateActivity);
    window.addEventListener('keydown', updateActivity);
    window.addEventListener('click', updateActivity);

    const interval = setInterval(checkInactivity, CHECK_INTERVAL);

    return () => {
      window.removeEventListener('mousemove', updateActivity);
      window.removeEventListener('keydown', updateActivity);
      window.removeEventListener('click', updateActivity);
      clearInterval(interval);
    };
  }, [user, signOut]);

  if (loading || !profileChecked) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-lumos-bg">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-lumos-yellow"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-lumos-bg text-white p-6 text-center">
        <div className="bg-red-500/10 border border-red-500 p-6 rounded-lumos max-w-md">
          <h2 className="text-xl font-bold mb-2">Erro de Configuração</h2>
          <p className="text-lumos-text-secondary text-sm mb-4">
            Não foi possível inicializar a conexão com o banco de dados.
          </p>
          <code className="block bg-black/50 p-2 rounded text-xs text-left overflow-auto">
            {error}
          </code>
        </div>
      </div>
    );
  }
  
  if (!user) return <Navigate to="/login" />;

  // VALIDAÇÃO DE PERFIL LUMOS
  if (user && profileChecked && !profile) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-lumos-bg text-white p-6 text-center">
        <div className="bg-yellow-500/10 border border-yellow-500 p-8 rounded-lumos max-w-md">
          <h2 className="text-xl font-bold mb-2">Acesso Pendente</h2>
          <p className="text-lumos-text-secondary text-sm mb-6">
            Sua conta Supabase foi criada, mas você ainda não possui um perfil autorizado na plataforma. 
            Contate um administrador para habilitar seu acesso.
          </p>
          <button onClick={() => signOut()} className="btn-primary w-full">Sair</button>
        </div>
      </div>
    );
  }

  if (!loading && profile?.status === 'inativo') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-lumos-bg text-white p-6 text-center">
        <div className="bg-red-500/10 border border-red-500 p-8 rounded-lumos max-w-md">
          <h2 className="text-xl font-bold mb-2">Acesso Bloqueado</h2>
          <p className="text-lumos-text-secondary text-sm mb-6">
            Sua conta está inativa. Se acredita que isso é um erro, procure a administração.
          </p>
          <button onClick={() => signOut()} className="btn-primary w-full">Sair</button>
        </div>
      </div>
    );
  }

  const location = useLocation();

  if (profile?.role === 'producao' && location.pathname === '/') {
    return <Navigate to="/financeiro/custos-projeto" />;
  }
  if (profile?.role === 'basico' && location.pathname === '/') {
    return <Navigate to="/financeiro/reembolso" />;
  }

  return (
    <LayoutProvider>
      {showTimeoutWarning && (
        <div className="fixed top-0 left-0 right-0 z-[300] bg-yellow-500 text-black px-4 py-2 flex items-center justify-between text-sm font-semibold shadow-lg">
          <span>⚠️ Sua sessão expira em menos de 5 minutos por inatividade. Clique em qualquer lugar para continuar.</span>
          <button
            onClick={() => {
              localStorage.setItem('lumos_last_activity', Date.now().toString());
              setShowTimeoutWarning(false);
            }}
            className="ml-4 underline hover:no-underline"
          >
            Renovar sessão
          </button>
        </div>
      )}
      <Sidebar>{children}</Sidebar>
    </LayoutProvider>
  );
}

function AppContent() {
  return (
    <Router>
      <div className="min-h-screen bg-lumos-bg">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/aprovar/:token" element={<AprovacaoPublica />} />
          <Route path="/cadastro-fornecedor" element={<CadastroFornecedorPublico />} />
          
          <Route 
            path="/" 
            element={<AuthWrapper><Dashboard /></AuthWrapper>} 
          />
          
          <Route 
            path="/orcamentos" 
            element={<AuthWrapper><Budgets /></AuthWrapper>} 
          />
          
          <Route 
            path="/clientes" 
            element={<AuthWrapper><Clients /></AuthWrapper>} 
          />
          
          <Route 
            path="/clientes/:id" 
            element={<AuthWrapper><ClientProfile /></AuthWrapper>} 
          />
          
          <Route 
            path="/orcamentos/novo" 
            element={<AuthWrapper><BudgetEditorPage /></AuthWrapper>} 
          />
          
          <Route 
            path="/orcamentos/:id" 
            element={<AuthWrapper><BudgetEditorPage /></AuthWrapper>} 
          />
          
          <Route 
            path="/catalogo" 
            element={<AuthWrapper><Catalog /></AuthWrapper>} 
          />
          
          <Route 
            path="/templates" 
            element={<AuthWrapper><Templates /></AuthWrapper>} 
          />
          
          <Route 
            path="/configuracoes" 
            element={<AuthWrapper><Settings /></AuthWrapper>} 
          />

          <Route 
            path="/equipe" 
            element={<AuthWrapper><Equipe /></AuthWrapper>} 
          />

          {/* NOVAS ROTAS FINANCEIRAS */}
          <Route 
            path="/financeiro" 
            element={
              <AuthWrapper>
                <PermissionGuard permission="financeiro_dashboard">
                  <FinanceiroDashboard />
                </PermissionGuard>
              </AuthWrapper>
            } 
          />
          <Route 
            path="/financeiro/contas-pagar" 
            element={
              <AuthWrapper>
                <PermissionGuard permission="financeiro_admin">
                  <ContasPagar />
                </PermissionGuard>
              </AuthWrapper>
            } 
          />
          <Route 
            path="/financeiro/contas-receber" 
            element={
              <AuthWrapper>
                <PermissionGuard permission="financeiro_admin">
                  <ContasReceber />
                </PermissionGuard>
              </AuthWrapper>
            } 
          />
          <Route 
            path="/financeiro/reembolso" 
            element={
              <AuthWrapper>
                <PermissionGuard permission="reembolso">
                  <Reembolso />
                </PermissionGuard>
              </AuthWrapper>
            } 
          />
          <Route 
            path="/financeiro/custos-projeto" 
            element={
              <AuthWrapper>
                <PermissionGuard permission="custos_projeto">
                  <CustosProjeto />
                </PermissionGuard>
              </AuthWrapper>
            } 
          />
          <Route
            path="/financeiro/custos-projeto/:id"
            element={
              <AuthWrapper>
                <PermissionGuard permission="custos_projeto">
                  <CustosProjetoDetalhe />
                </PermissionGuard>
              </AuthWrapper>
            }
          />
          <Route
            path="/financeiro/fluxo-de-caixa"
            element={
              <AuthWrapper>
                <PermissionGuard permission="financeiro_admin">
                  <FluxoDeCaixa />
                </PermissionGuard>
              </AuthWrapper>
            }
          />
          <Route
            path="/financeiro/custos-fixos"
            element={
              <AuthWrapper>
                <PermissionGuard permission="financeiro_admin">
                  <CustosFixos />
                </PermissionGuard>
              </AuthWrapper>
            }
          />
          <Route
            path="/financeiro/configuracao"
            element={
              <AuthWrapper>
                <PermissionGuard permission="financeiro_admin">
                  <FinanceiroConfig />
                </PermissionGuard>
              </AuthWrapper>
            }
          />
          <Route
            path="/financeiro/relatorios"
            element={
              <AuthWrapper>
                <PermissionGuard permission="financeiro_admin">
                  <FinanceiroRelatorios />
                </PermissionGuard>
              </AuthWrapper>
            }
          />
          {/* PRODUÇÃO — Dashboard */}
          <Route
            path="/producao/dashboard"
            element={
              <AuthWrapper>
                <PermissionGuard permission="ordem_do_dia">
                  <ProducaoDashboard />
                </PermissionGuard>
              </AuthWrapper>
            }
          />

          {/* PRODUÇÃO — Ordem do Dia */}
          <Route
            path="/ordem-do-dia"
            element={
              <AuthWrapper>
                <PermissionGuard permission="ordem_do_dia">
                  <OrdensDoDia />
                </PermissionGuard>
              </AuthWrapper>
            }
          />
          <Route
            path="/ordem-do-dia/nova"
            element={
              <AuthWrapper>
                <PermissionGuard permission="ordem_do_dia">
                  <OrdemDoDiaEditor />
                </PermissionGuard>
              </AuthWrapper>
            }
          />
          <Route
            path="/ordem-do-dia/:id"
            element={
              <AuthWrapper>
                <PermissionGuard permission="ordem_do_dia">
                  <OrdemDoDiaEditor />
                </PermissionGuard>
              </AuthWrapper>
            }
          />

          {/* PRODUÇÃO — Fornecedores */}
          <Route
            path="/producao/fornecedores"
            element={
              <AuthWrapper>
                <PermissionGuard permission="fornecedores">
                  <Fornecedores />
                </PermissionGuard>
              </AuthWrapper>
            }
          />
          <Route
            path="/producao/fornecedores/nova"
            element={
              <AuthWrapper>
                <PermissionGuard permission="fornecedores">
                  <FornecedorEditor />
                </PermissionGuard>
              </AuthWrapper>
            }
          />
          <Route
            path="/producao/fornecedores/:id"
            element={
              <AuthWrapper>
                <PermissionGuard permission="fornecedores">
                  <FornecedorEditor />
                </PermissionGuard>
              </AuthWrapper>
            }
          />

          <Route
            path="/usuarios"
            element={
              <AuthWrapper>
                <PermissionGuard permission="admin">
                  <UsersPage />
                </PermissionGuard>
              </AuthWrapper>
            }
          />
          <Route
            path="/auditoria"
            element={
              <AuthWrapper>
                <PermissionGuard permission="admin">
                  <AuditLog />
                </PermissionGuard>
              </AuthWrapper>
            }
          />
        </Routes>
      </div>
    </Router>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
