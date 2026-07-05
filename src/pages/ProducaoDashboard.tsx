import React, { useEffect, useState, useMemo } from 'react';
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

export default function ProducaoDashboard() {
  const { profile } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  // State
  const [currentDate, setCurrentDate] = useState(new Date());
  const [ordens, setOrdens] = useState<OrdemDoDiaEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Google Calendar Integration State
  const [googleEvents, setGoogleEvents] = useState<any[]>([]);
  const [loadingCalendar, setLoadingCalendar] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [selectedGoogleEvent, setSelectedGoogleEvent] = useState<any | null>(null);

  // Carrega Ordens do Dia Locais
  useEffect(() => {
    fetchOrdensLocais();
  }, []);

  async function fetchOrdensLocais() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('ordens_do_dia')
        .select('id, codigo, titulo, data_producao')
        .order('data_producao', { ascending: true });

      if (error) throw error;
      setOrdens(data || []);
    } catch (err: any) {
      console.error('Error fetching local events:', err);
      toast.error(`Erro ao carregar dados locais: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

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

  // Calendar grid math
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart, { weekStartsOn: 0 }); // Sunday
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: startDate, end: endDate });

  const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));
  const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));

  // =========================================================================
  // ARQUITETURA DE MESCLAGEM DE EVENTOS (Preparando para futuras fontes)
  // =========================================================================
  const getNormalizedEventsForDay = useMemo(() => {
    return (day: Date) => {
      const targetStr = day.toLocaleDateString('en-CA'); // YYYY-MM-DD local
      const unifiedEvents: any[] = [];

      // 1. Fonte A: Ordens do Dia Locais (Amarelo, ☀️)
      ordens.forEach(o => {
        if (o.data_producao) {
          const dateStr = o.data_producao.split('T')[0];
          if (dateStr === targetStr) {
            unifiedEvents.push({
              id: `local-${o.id}`,
              title: o.titulo,
              subtitle: o.codigo,
              type: 'local',
              icon: '☀️',
              colorClass: 'bg-lumos-yellow text-black hover:bg-yellow-400',
              link: `/ordem-do-dia/${o.id}`
            });
          }
        }
      });

      // 2. Fonte B: Google Calendar (Azul, 📅)
      googleEvents.forEach(e => {
        if (e.start) {
          const dateStr = e.start.split('T')[0];
          if (dateStr === targetStr) {
            unifiedEvents.push({
              id: `google-${e.id}`,
              title: e.title,
              subtitle: 'Google',
              type: 'google',
              icon: '📅',
              colorClass: 'text-blue-600 dark:text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 dark:border-blue-500/30',
              rawEvent: e
            });
          }
        }
      });

      // 3. (Futuro) Fonte C: Tarefas do Gerenciador de Projetos (data_fim)
      // Adicionar nova lógica aqui futuramente sem alterar a renderização do grid

      return unifiedEvents;
    };
  }, [ordens, googleEvents]);

  return (
    <div className="space-y-6 font-work-sans text-lumos-text-primary max-w-7xl mx-auto pb-10">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-lumos-text-primary tracking-tight">Calendário de Produção</h1>
          <p className="text-lumos-text-secondary text-sm">Visualização unificada de diárias operacionais e eventos externos integrados.</p>
        </div>
        
        {/* Legendas de cores das fontes */}
        <div className="flex items-center gap-4 bg-lumos-surface border border-lumos-border/50 px-4 py-2 rounded-lumos text-xs font-bold shadow-sm">
          <span className="text-[10px] font-black uppercase tracking-wider text-lumos-text-secondary mr-1">Legenda:</span>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded bg-lumos-yellow inline-block" />
            <span>Ordem do Dia (Lumos)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded bg-blue-500 inline-block" />
            <span>Google Calendar</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card p-20 text-center flex flex-col items-center justify-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-lumos-yellow mx-auto"></div>
          <p className="text-xs text-lumos-text-secondary font-bold uppercase tracking-wider">Carregando calendário...</p>
        </div>
      ) : (
        <div className="card p-6 flex flex-col min-h-[750px] shadow-sm">
          
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
                className="p-1.5 rounded-lg border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/5 transition-all cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button 
                onClick={nextMonth}
                className="p-1.5 rounded-lg border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/5 transition-all cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Banner de Aviso do OAuth Google */}
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
          <div className="grid grid-cols-7 text-center py-3 border-b border-lumos-border/30 flex-shrink-0">
            {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(day => (
              <span key={day} className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">
                {day}
              </span>
            ))}
          </div>

          {/* Monthly grid */}
          <div className="grid grid-cols-7 gap-px bg-lumos-border/50 rounded overflow-hidden flex-1 mt-2">
            {days.map((day, idx) => {
              const dayEvents = getNormalizedEventsForDay(day);
              const isCurrentMonth = isSameMonth(day, currentDate);
              const isToday = isSameDay(day, new Date());

              return (
                <div
                  key={idx}
                  className={clsx(
                    "bg-lumos-surface p-2.5 min-h-[100px] flex flex-col justify-between transition-colors",
                    !isCurrentMonth && "opacity-30 bg-lumos-bg/30",
                    isToday && "ring-1 ring-inset ring-lumos-yellow/45 bg-lumos-yellow/[0.01]"
                  )}
                >
                  {/* Day number */}
                  <span className={clsx(
                    "text-[10px] font-bold self-end w-5 h-5 rounded-full flex items-center justify-center select-none",
                    isToday ? "bg-lumos-yellow text-black font-black" : "text-lumos-text-primary"
                  )}>
                    {format(day, "d")}
                  </span>

                  {/* Day events (Unified/Meshed list) */}
                  <div className="mt-2 space-y-1.5 overflow-y-auto max-h-[90px] custom-scrollbar">
                    {dayEvents.map(event => {
                      if (event.type === 'local') {
                        return (
                          <Link
                            key={event.id}
                            to={event.link}
                            className={clsx(
                              "block px-1.5 py-0.5 rounded text-[9px] font-black truncate tracking-tight transition-colors leading-tight",
                              event.colorClass
                            )}
                            title={`Ordem do Dia: ${event.subtitle} - ${event.title}`}
                          >
                            {event.icon} {event.subtitle}
                          </Link>
                        );
                      } else {
                        return (
                          <button
                            key={event.id}
                            onClick={e => {
                              e.stopPropagation();
                              setSelectedGoogleEvent(event.rawEvent);
                            }}
                            className={clsx(
                              "block w-full text-left px-1.5 py-0.5 rounded text-[9px] font-bold truncate tracking-tight transition-colors leading-tight cursor-pointer",
                              event.colorClass
                            )}
                            title={`Google: ${event.title}`}
                          >
                            {event.icon} {event.title}
                          </button>
                        );
                      }
                    })}
                  </div>
                </div>
              );
            })}
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
