import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval, 
  isSameDay, 
  addMonths, 
  subMonths,
  parseISO,
  isSameMonth
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { 
  ChevronLeft, 
  ChevronRight, 
  Calendar, 
  Plus, 
  Check, 
  Trash2, 
  Projector, 
  CheckCircle, 
  Circle,
  Briefcase,
  AlertTriangle,
  ExternalLink
} from 'lucide-react';
import { clsx } from 'clsx';
import Modal from '@/components/common/Modal';
interface OrdemDoDiaEvent {
  id: string;
  codigo: string;
  titulo: string;
  data_producao: string | null;
}

interface Project {
  id: string;
  name: string;
  code: string;
}

interface ProducaoTodo {
  id: string;
  project_id: string;
  descricao: string;
  done: boolean;
  due_date: string | null;
  created_at: string;
  created_by: string | null;
}

export default function ProducaoDashboard() {
  const { user, profile } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  // State
  const [currentDate, setCurrentDate] = useState(new Date());
  const [ordens, setOrdens] = useState<OrdemDoDiaEvent[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [todos, setTodos] = useState<ProducaoTodo[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Google Calendar Integration State
  const [googleEvents, setGoogleEvents] = useState<any[]>([]);
  const [loadingCalendar, setLoadingCalendar] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [selectedGoogleEvent, setSelectedGoogleEvent] = useState<any | null>(null);

  // Form State for new Todo
  const [newTodoDesc, setNewTodoDesc] = useState('');
  const [newTodoProject, setNewTodoProject] = useState('');
  const [newTodoDueDate, setNewTodoDueDate] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  // Busca eventos do Google Calendar ao mudar o mês/dia atual
  useEffect(() => {
    const fetchGoogleEvents = async () => {
      const monthStart = startOfMonth(currentDate);
      const monthEnd = endOfMonth(monthStart);
      const start = startOfWeek(monthStart, { weekStartsOn: 0 });
      const end = endOfWeek(monthEnd, { weekStartsOn: 0 });

      setLoadingCalendar(true);
      setCalendarError(null);
      try {
        const timeMin = start.toISOString();
        const timeMax = end.toISOString();
        
        const { data, error } = await supabase.functions.invoke(
          `get-calendar-events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`,
          { method: 'GET' }
        );

        if (error) throw error;
        setGoogleEvents(data?.events || []);
      } catch (err: any) {
        console.error('Error fetching calendar events:', err);
        setCalendarError(err.message || 'Erro de conexão.');
      } finally {
        setLoadingCalendar(false);
      }
    };

    fetchGoogleEvents();
  }, [currentDate]);

  async function fetchDashboardData() {
    try {
      setLoading(true);
      
      // Fetch ordens do dia, active projects and production todos
      const [ordensRes, projectsRes, todosRes] = await Promise.all([
        supabase
          .from('ordens_do_dia')
          .select('id, codigo, titulo, data_producao')
          .order('data_producao', { ascending: true }),
        supabase
          .from('projects')
          .select('id, name, code')
          .order('name', { ascending: true }),
        supabase
          .from('producao_todos')
          .select('*')
          .order('created_at', { ascending: false })
      ]);

      if (ordensRes.error) throw ordensRes.error;
      if (projectsRes.error) throw projectsRes.error;
      if (todosRes.error) throw todosRes.error;

      setOrdens(ordensRes.data || []);
      setProjects(projectsRes.data || []);
      setTodos(todosRes.data || []);

      // Autofill project select if projects are found
      if (projectsRes.data && projectsRes.data.length > 0) {
        setNewTodoProject(projectsRes.data[0].id);
      }
    } catch (err: any) {
      console.error('Error fetching dashboard data:', err);
      toast.error(`Erro ao carregar dados: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  // Calendar calculations
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart, { weekStartsOn: 0 }); // Sunday
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 0 });

  const days = eachDayOfInterval({ start: startDate, end: endDate });

  const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));
  const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));

  const getEventsForDay = (day: Date) => {
    return ordens.filter(o => {
      if (!o.data_producao) return false;
      const eventDate = parseISO(o.data_producao);
      return isSameDay(eventDate, day);
    });
  };

  const getGoogleEventsForDay = (day: Date) => {
    const targetStr = day.toLocaleDateString('en-CA');
    return googleEvents.filter(e => {
      if (!e.start) return false;
      const dateStr = e.start.split('T')[0];
      return dateStr === targetStr;
    });
  };

  // Todo Handlers
  const handleAddTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTodoDesc.trim() || !newTodoProject) {
      toast.error('Preencha a descrição e selecione um projeto.');
      return;
    }

    try {
      setActionLoading(true);
      const payload = {
        project_id: newTodoProject,
        descricao: newTodoDesc,
        done: false,
        due_date: newTodoDueDate || null,
        created_by: profile?.id || null
      };

      const { data, error } = await supabase
        .from('producao_todos')
        .insert([payload])
        .select();

      if (error) throw error;

      toast.success('Tarefa adicionada com sucesso!');
      setNewTodoDesc('');
      setNewTodoDueDate('');
      
      // Update local state
      if (data) {
        setTodos(prev => [data[0], ...prev]);
      }
    } catch (err: any) {
      console.error('Error adding todo:', err);
      toast.error(`Erro ao salvar tarefa: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleTodo = async (todoId: string, currentDone: boolean) => {
    try {
      const { error } = await supabase
        .from('producao_todos')
        .update({ done: !currentDone })
        .eq('id', todoId);

      if (error) throw error;

      // Update local state
      setTodos(prev => prev.map(t => t.id === todoId ? { ...t, done: !currentDone } : t));
      toast.success(currentDone ? 'Tarefa reaberta.' : '✓ Tarefa concluída!');
    } catch (err: any) {
      console.error('Error updating todo:', err);
      toast.error(`Erro ao alterar status da tarefa: ${err.message}`);
    }
  };

  const handleDeleteTodo = async (todoId: string) => {
    try {
      const { error } = await supabase
        .from('producao_todos')
        .delete()
        .eq('id', todoId);

      if (error) throw error;

      // Update local state
      setTodos(prev => prev.filter(t => t.id !== todoId));
      toast.success('Tarefa removida.');
    } catch (err: any) {
      console.error('Error deleting todo:', err);
      toast.error(`Erro ao excluir tarefa: ${err.message}`);
    }
  };

  // Group Todos by Project
  const groupedTodos = projects.map(project => {
    const projectTodos = todos.filter(t => t.project_id === project.id);
    return {
      ...project,
      todos: projectTodos
    };
  }).filter(p => p.todos.length > 0);

  return (
    <div className="space-y-6 font-work-sans">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-lumos-text-primary tracking-tight">Dashboard de Produção</h1>
        <p className="text-lumos-text-secondary text-sm">Calendário de diárias operacionais e cronograma de tarefas por projeto.</p>
      </div>

      {loading ? (
        <div className="card p-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-lumos-yellow mx-auto"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Left/Middle: Calendar (2 cols) */}
          <div className="xl:col-span-2 space-y-6">
            <div className="card p-6 flex flex-col h-[640px]">
              {/* Calendar Header */}
              <div className="flex items-center justify-between pb-4 border-b border-lumos-border flex-shrink-0">
                <div className="flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-lumos-yellow" />
                  <h2 className="text-md font-bold text-lumos-text-primary uppercase tracking-wider flex items-center gap-2">
                    {format(currentDate, "MMMM 'de' yyyy", { locale: ptBR })}
                    {loadingCalendar && (
                      <span className="inline-block w-3.5 h-3.5 border-2 border-lumos-yellow border-t-transparent rounded-full animate-spin" />
                    )}
                  </h2>
                </div>
                <div className="flex items-center gap-1.5">
                  <button 
                    onClick={prevMonth}
                    className="p-1.5 rounded-lg border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/5 transition-all"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={nextMonth}
                    className="p-1.5 rounded-lg border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/5 transition-all"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Banner de Aviso de Google Calendar não Conectado ou com Erro */}
              {calendarError && (
                <div className="mt-4 p-3 rounded bg-red-500/10 border border-red-500/20 text-red-500 flex items-center justify-between gap-4 text-xs font-semibold select-none">
                  <span className="flex items-center gap-2 text-left">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    {calendarError.includes('não configurada') || calendarError.includes('401')
                      ? 'Calendário Google compartilhado não conectado.'
                      : `Google Calendar: ${calendarError}`}
                  </span>
                  {profile?.role === 'admin' && (calendarError.includes('não configurada') || calendarError.includes('401')) && (
                    <a
                      href="https://byntpekyfhzwfihjhzuo.supabase.co/functions/v1/google-auth-start"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1 bg-red-500 hover:bg-red-600 text-white rounded text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap"
                    >
                      Conectar
                    </a>
                  )}
                </div>
              )}

              {/* Weekday names */}
              <div className="grid grid-cols-7 text-center py-2 flex-shrink-0">
                {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(day => (
                  <span key={day} className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">
                    {day}
                  </span>
                ))}
              </div>

              {/* Monthly grid */}
              <div className="grid grid-cols-7 gap-px bg-lumos-border/50 rounded overflow-hidden flex-1 mt-2">
                {days.map((day, idx) => {
                  const dayEvents = getEventsForDay(day);
                  const isCurrentMonth = isSameMonth(day, currentDate);
                  const isToday = isSameDay(day, new Date());

                  return (
                    <div
                      key={idx}
                      className={clsx(
                        "bg-lumos-surface p-1.5 min-h-[70px] flex flex-col justify-between transition-colors",
                        !isCurrentMonth && "opacity-30 bg-lumos-bg/30",
                        isToday && "ring-1 ring-inset ring-lumos-yellow/45"
                      )}
                    >
                      {/* Day number */}
                      <span className={clsx(
                        "text-[10px] font-bold self-end w-5 h-5 rounded-full flex items-center justify-center",
                        isToday ? "bg-lumos-yellow text-black font-black" : "text-lumos-text-primary"
                      )}>
                        {format(day, "d")}
                      </span>

                      {/* Day events/productions */}
                      <div className="mt-1 space-y-1 overflow-y-auto max-h-[70px] custom-scrollbar">
                        {/* Ordens do Dia Locais */}
                        {dayEvents.map(event => (
                          <Link
                            key={event.id}
                            to={`/ordem-do-dia/${event.id}`}
                            className="block px-1.5 py-0.5 rounded text-[9px] font-black text-black bg-lumos-yellow hover:bg-yellow-400 truncate tracking-tight transition-colors leading-tight"
                            title={`Ordem do Dia: ${event.codigo} - ${event.titulo}`}
                          >
                            ☀️ {event.codigo}
                          </Link>
                        ))}
                        {/* Eventos do Google Calendar */}
                        {getGoogleEventsForDay(day).map(event => (
                          <button
                            key={event.id}
                            onClick={e => {
                              e.stopPropagation();
                              setSelectedGoogleEvent(event);
                            }}
                            className="block w-full text-left px-1.5 py-0.5 rounded text-[9px] font-bold text-blue-600 dark:text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 dark:border-blue-500/30 truncate tracking-tight transition-colors leading-tight cursor-pointer"
                            title={`Google: ${event.title}`}
                          >
                            📅 {event.title}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right: To-do List (1 col) */}
          <div className="space-y-6 flex flex-col h-[640px]">
            {/* Create Todo Form */}
            <div className="card p-5 flex-shrink-0">
              <h2 className="text-xs font-black uppercase tracking-wider text-lumos-text-secondary mb-3 flex items-center gap-1.5">
                <Plus className="w-4 h-4 text-lumos-yellow" /> Nova Tarefa Operacional
              </h2>
              <form onSubmit={handleAddTodo} className="space-y-3.5">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-lumos-text-secondary uppercase">Descrição</label>
                  <input
                    required
                    type="text"
                    placeholder="Ex: Alugar gerador de energia..."
                    className="input-lumos w-full text-xs h-9 px-3"
                    value={newTodoDesc}
                    onChange={e => setNewTodoDesc(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-lumos-text-secondary uppercase">Projeto</label>
                    <select
                      required
                      className="input-lumos w-full text-xs h-9 px-2"
                      value={newTodoProject}
                      onChange={e => setNewTodoProject(e.target.value)}
                    >
                      {projects.length === 0 ? (
                        <option value="">Nenhum projeto</option>
                      ) : (
                        projects.map(p => (
                          <option key={p.id} value={p.id}>
                            [{p.code}] {p.name}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-lumos-text-secondary uppercase">Prazo (opcional)</label>
                    <input
                      type="date"
                      className="input-lumos w-full text-xs h-9 px-2"
                      value={newTodoDueDate}
                      onChange={e => setNewTodoDueDate(e.target.value)}
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={actionLoading || projects.length === 0}
                  className="btn-primary w-full text-xs py-2 font-black uppercase tracking-wider flex items-center justify-center gap-1.5"
                >
                  {actionLoading ? <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-white"></div> : 'Adicionar'}
                </button>
              </form>
            </div>

            {/* Todo List Grouped by Project */}
            <div className="card p-5 flex-1 flex flex-col min-h-0">
              <h2 className="text-xs font-black uppercase tracking-wider text-lumos-text-secondary mb-3 flex items-center gap-1.5 flex-shrink-0">
                <Briefcase className="w-4 h-4 text-lumos-yellow" /> Diários e Tarefas por Projeto
              </h2>

              <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar space-y-4 min-h-0">
                {groupedTodos.length === 0 ? (
                  <p className="text-xs text-lumos-text-secondary italic text-center py-12">Nenhuma tarefa registrada.</p>
                ) : (
                  groupedTodos.map(group => (
                    <div key={group.id} className="space-y-2 border border-lumos-border/40 p-3 rounded bg-lumos-bg/30">
                      {/* Project Header */}
                      <div className="flex items-center justify-between border-b border-lumos-border/50 pb-1.5 flex-shrink-0">
                        <span className="text-xs font-black text-lumos-text-primary tracking-tight truncate max-w-[70%]">
                          {group.name}
                        </span>
                        <span className="text-[9px] font-bold bg-lumos-yellow/15 text-lumos-yellow border border-lumos-yellow/20 px-1.5 py-0.5 rounded uppercase">
                          {group.code}
                        </span>
                      </div>

                      {/* Project Tasks */}
                      <ul className="space-y-2">
                        {group.todos.map(todo => (
                          <li 
                            key={todo.id}
                            className="flex items-start justify-between gap-3 group/todo hover:bg-lumos-text-secondary/5 p-1.5 rounded transition-all"
                          >
                            <div className="flex items-start gap-2 min-w-0">
                              <button
                                onClick={() => handleToggleTodo(todo.id, todo.done)}
                                className="mt-0.5 text-lumos-text-secondary hover:text-lumos-yellow transition-all flex-shrink-0"
                              >
                                {todo.done ? (
                                  <CheckCircle className="w-4 h-4 text-green-500" />
                                ) : (
                                  <Circle className="w-4 h-4" />
                                )}
                              </button>
                              <div className="flex flex-col min-w-0">
                                <span className={clsx(
                                  "text-xs font-medium text-lumos-text-primary break-words leading-tight",
                                  todo.done && "line-through text-lumos-text-secondary/60"
                                )}>
                                  {todo.descricao}
                                </span>
                                {todo.due_date && (
                                  <span className="text-[9px] text-lumos-text-secondary font-semibold uppercase tracking-wider mt-1 flex items-center gap-1">
                                    Prazo: {new Date(todo.due_date + 'T12:00:00').toLocaleDateString('pt-BR')}
                                  </span>
                                )}
                              </div>
                            </div>

                            <button
                              onClick={() => handleDeleteTodo(todo.id)}
                              className="p-1 rounded-full text-lumos-text-secondary hover:text-red-500 hover:bg-red-500/10 opacity-0 group-hover/todo:opacity-100 transition-all flex-shrink-0"
                              title="Excluir tarefa"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Detalhes do Evento do Google Calendar */}
      {selectedGoogleEvent && (
        <Modal
          isOpen={!!selectedGoogleEvent}
          onClose={() => setSelectedGoogleEvent(null)}
          title="Detalhes do Evento"
          maxWidth="max-w-md"
        >
          <div className="space-y-4 text-left font-work-sans">
            <div>
              <span className="block text-[8px] font-bold text-lumos-text-secondary uppercase tracking-widest">Título</span>
              <h3 className="text-sm font-black text-lumos-text-primary leading-tight mt-0.5">
                {selectedGoogleEvent.title}
              </h3>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="block text-[8px] font-bold text-lumos-text-secondary uppercase tracking-widest">Início</span>
                <span className="text-xs font-bold text-lumos-text-primary block mt-0.5">
                  {selectedGoogleEvent.allDay 
                    ? new Date(selectedGoogleEvent.start + 'T12:00:00').toLocaleDateString('pt-BR')
                    : new Date(selectedGoogleEvent.start).toLocaleString('pt-BR')}
                </span>
              </div>
              <div>
                <span className="block text-[8px] font-bold text-lumos-text-secondary uppercase tracking-widest">Término</span>
                <span className="text-xs font-bold text-lumos-text-primary block mt-0.5">
                  {selectedGoogleEvent.allDay
                    ? new Date(selectedGoogleEvent.end + 'T12:00:00').toLocaleDateString('pt-BR')
                    : new Date(selectedGoogleEvent.end).toLocaleString('pt-BR')}
                </span>
              </div>
            </div>

            {selectedGoogleEvent.description && (
              <div>
                <span className="block text-[8px] font-bold text-lumos-text-secondary uppercase tracking-widest">Descrição</span>
                <p className="text-xs text-lumos-text-secondary whitespace-pre-wrap leading-relaxed mt-1 border border-lumos-border/50 bg-lumos-bg/30 p-2.5 rounded">
                  {selectedGoogleEvent.description}
                </p>
              </div>
            )}

            {selectedGoogleEvent.htmlLink && (
              <div className="pt-2 border-t border-lumos-border/40 flex justify-end">
                <a
                  href={selectedGoogleEvent.htmlLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-lumos-yellow hover:underline"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Ver no Google Calendar
                </a>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
