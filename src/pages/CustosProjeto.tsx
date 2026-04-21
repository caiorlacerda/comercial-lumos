import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Briefcase, Search, TrendingUp, TrendingDown, ChevronRight, Target } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export default function CustosProjeto() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => { fetchProjects(); }, []);

  async function fetchProjects() {
    try {
      setLoading(true);
      const { data, error } = await supabase.from('budgets').select('id, project_name, client:clients(name), status, receivable:receivables(total_amount), costs:project_costs(amount)').eq('status', 'aprovado');
      const processed = (data || []).map(p => {
        const totalAmount = p.receivable?.[0]?.total_amount || 0;
        const totalCosts = p.costs?.reduce((acc: number, c: any) => acc + c.amount, 0) || 0;
        const margin = totalAmount - totalCosts;
        const marginPercent = totalAmount > 0 ? (margin / totalAmount) * 100 : 0;
        return { ...p, totalAmount, totalCosts, margin, marginPercent };
      });
      setProjects(processed);
    } catch (error) { console.error(error); } finally { setLoading(false); }
  }

  const filtered = projects.filter(p => p.project_name.toLowerCase().includes(searchTerm.toLowerCase()) || p.client?.name?.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className="space-y-6 font-work-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-lumos-text-primary tracking-tight">Custos de Projeto</h1>
          <p className="text-lumos-text-secondary text-sm">Lucratividade real de cada projeto aprovado.</p>
        </div>
      </div>

      <div className="card p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary" />
          <input type="text" placeholder="Buscar projeto ou cliente..." className="input-lumos pl-10 w-full h-10" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {loading ? (
          <div className="card p-12 text-center"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-lumos-yellow mx-auto"></div></div>
        ) : filtered.length === 0 ? (
          <div className="card p-12 text-center text-lumos-text-secondary text-sm italic">Nenhum projeto.</div>
        ) : (
          filtered.map((p) => (
            <div key={p.id} onClick={() => navigate(`/financeiro/custos-projeto/${p.id}`)} className="card p-6 flex flex-col md:flex-row items-center gap-6 hover:border-lumos-yellow/30 cursor-pointer group">
              <div className="flex-1 w-full">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-black text-lumos-yellow bg-lumos-yellow/10 px-2 py-0.5 rounded uppercase">Projeto</span>
                  <h3 className="text-lg font-bold text-lumos-text-primary group-hover:text-lumos-yellow transition-colors">{p.project_name}</h3>
                </div>
                <p className="text-xs text-lumos-text-secondary flex items-center gap-1"><Target className="w-3 h-3" /> {p.client?.name}</p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-8 w-full md:w-auto border-t md:border-t-0 md:border-l border-lumos-border pt-4 md:pt-0 md:pl-8">
                <div><p className="text-[10px] font-bold text-lumos-text-secondary uppercase">Venda</p><p className="text-sm font-bold text-lumos-text-primary">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.totalAmount)}</p></div>
                <div><p className="text-[10px] font-bold text-lumos-text-secondary uppercase">Custos</p><p className="text-sm font-bold text-lumos-text-primary">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.totalCosts)}</p></div>
                <div><p className="text-[10px] font-bold text-lumos-text-secondary uppercase">Margem</p><p className={`text-sm font-black ${p.margin >= 0 ? 'text-green-500' : 'text-red-500'}`}>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.margin)}</p></div>
                <div className="flex items-center justify-end"><div className={`flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-black ${p.marginPercent > 30 ? 'bg-green-500/10 text-green-500' : 'bg-yellow-500/10 text-yellow-500'}`}>{p.marginPercent.toFixed(1)}%</div><ChevronRight className="w-5 h-5 text-lumos-text-secondary ml-4 group-hover:translate-x-1 transition-transform" /></div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
