import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { throttle } from 'lodash';
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

function AuthWrapper({ children }: { children: React.ReactNode }) {
  const { user, loading, error, signOut } = useAuth();
  const lastActivityRef = useRef<number>(Date.now());
  
  useEffect(() => {
    if (!user) return;

    const STORAGE_KEY = 'lumos_last_activity';
    const TIMEOUT_MS = 3 * 60 * 60 * 1000; // 3 hours
    const CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes

    // Initialize/sync last activity
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
    }, 60000); // 1 minute throttle

    const checkInactivity = () => {
      const storedActivity = localStorage.getItem(STORAGE_KEY);
      const lastActivity = storedActivity ? parseInt(storedActivity, 10) : lastActivityRef.current;
      
      if (Date.now() - lastActivity > TIMEOUT_MS) {
        console.log('Session expired due to inactivity');
        signOut();
        window.location.href = '/login?timeout=true';
      }
    };

    // Listen for activity
    window.addEventListener('mousemove', updateActivity);
    window.addEventListener('keydown', updateActivity);
    window.addEventListener('click', updateActivity);

    // Check periodically
    const interval = setInterval(checkInactivity, CHECK_INTERVAL);

    return () => {
      window.removeEventListener('mousemove', updateActivity);
      window.removeEventListener('keydown', updateActivity);
      window.removeEventListener('click', updateActivity);
      clearInterval(interval);
    };
  }, [user, signOut]);

  if (loading) {
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
            Não foi possível inicializar a conexão com o banco de dados. Verifique se as credenciais do Supabase no arquivo .env estão corretas.
          </p>
          <code className="block bg-black/50 p-2 rounded text-xs text-left overflow-auto">
            {error}
          </code>
        </div>
      </div>
    );
  }
  
  return user ? <Sidebar>{children}</Sidebar> : <Navigate to="/login" />;
}

function AppContent() {
  return (
    <Router>
      <div className="min-h-screen bg-lumos-bg">
        <Routes>
          <Route path="/login" element={<Login />} />
          
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
