import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Users, Plus, Trash, Building2, X } from 'lucide-react';
import Modal from '@/components/common/Modal';
import { useToast } from '@/context/ToastContext';
import { logAudit } from '@/hooks/useAuditLog';
import { clsx } from 'clsx';

interface Client {
  id: string;
  name: string;
  agency_name?: string;
  marcas?: string[] | null;
}

interface ContactFormData {
  id?: string;
  name: string;
  email: string;
  phone: string;
  role: string;
}

interface ClientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  client?: Client | null;
}

const marcasAntesRemovidas = (antes: string[], agora: string[]) => antes.some(m => !agora.includes(m));

export default function ClientModal({ isOpen, onClose, onSuccess, client }: ClientModalProps) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    agency_name: '',
  });
  const [contacts, setContacts] = useState<ContactFormData[]>([
    { name: '', email: '', phone: '', role: '' }
  ]);
  // Marcas do cliente (lista fechada; cada projeto escolhe uma e a pasta do Drive nasce dentro dela).
  const [marcas, setMarcas] = useState<string[]>([]);
  const [novaMarca, setNovaMarca] = useState('');

  useEffect(() => {
    if (isOpen) {
      if (client) {
        setFormData({
          name: client.name,
          agency_name: client.agency_name || '',
        });
        setMarcas(client.marcas ?? []);
        setNovaMarca('');
        fetchContacts(client.id);
      } else {
        setMarcas([]);
        setNovaMarca('');
        setFormData({ name: '', agency_name: '' });
        setContacts([{ name: '', email: '', phone: '', role: '' }]);
      }
    }
  }, [isOpen, client]);

  async function fetchContacts(clientId: string) {
    const { data } = await supabase
      .from('client_contacts')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at');
    
    if (data && data.length > 0) {
      setContacts(data);
    } else {
      setContacts([{ name: '', email: '', phone: '', role: '' }]);
    }
  }

  const adicionarMarca = () => {
    const nome = novaMarca.replace(/[\\/]/g, '-').replace(/\s+/g, ' ').trim();
    if (!nome) return;
    if (marcas.some(m => m.toLowerCase() === nome.toLowerCase())) { toast.info('Essa marca já está na lista.'); return; }
    setMarcas([...marcas, nome]);
    setNovaMarca('');
  };

  const addContactRow = () => {
    setContacts([...contacts, { name: '', email: '', phone: '', role: '' }]);
  };

  const removeContactRow = (index: number) => {
    setContacts(contacts.filter((_, i) => i !== index));
  };

  const updateContact = (index: number, field: keyof ContactFormData, value: string) => {
    const newContacts = [...contacts];
    newContacts[index] = { ...newContacts[index], [field]: value };
    setContacts(newContacts);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      let clientId = client?.id;

      // A coluna `marcas` chega por migration: só vai no payload quando a lista mudou, para o
      // cadastro de clientes seguir funcionando em quem não mexe nas marcas.
      const marcasAntes = client?.marcas ?? [];
      const marcasMudaram = marcas.length !== marcasAntes.length || marcas.some((m, i) => m !== marcasAntes[i]);
      const payload = marcasMudaram ? { ...formData, marcas } : formData;

      // 1. Save/Update Client
      if (client) {
        const { error } = await supabase.from('clients').update(payload).eq('id', clientId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('clients').insert(payload).select().single();
        if (error) throw error;
        clientId = data.id;
        logAudit('client_created', `Cliente "${formData.name}" criado`, { client_id: clientId });
      }

      // 2. Save/Update Contacts
      if (clientId) {
        // Fetch current contacts in DB for this client
        const { data: dbContacts } = await supabase
          .from('client_contacts')
          .select('id')
          .eq('client_id', clientId);
        
        const dbContactIds = (dbContacts || []).map(c => c.id);
        const formContacts = contacts.filter(c => c.name.trim());
        
        // Contacts to delete (existed in DB but not in form)
        const formContactIds = formContacts.map(c => c.id).filter(Boolean) as string[];
        const idsToDelete = dbContactIds.filter(id => !formContactIds.includes(id));
        
        if (idsToDelete.length > 0) {
          const { error: delError } = await supabase
            .from('client_contacts')
            .delete()
            .in('id', idsToDelete);
          if (delError) throw delError;
        }
        
        // Contacts to insert (no id)
        const contactsToInsert = formContacts
          .filter(c => !c.id)
          .map(c => {
            const idx = formContacts.indexOf(c);
            return {
              client_id: clientId,
              name: c.name,
              email: c.email,
              phone: c.phone,
              role: c.role,
              is_primary: idx === 0
            };
          });
        
        if (contactsToInsert.length > 0) {
          const { error: insError } = await supabase
            .from('client_contacts')
            .insert(contactsToInsert);
          if (insError) throw insError;
        }
        
        // Contacts to update (has id)
        const contactsToUpdate = formContacts.filter(c => c.id);
        for (const c of contactsToUpdate) {
          const idx = formContacts.indexOf(c);
          const { error: updError } = await supabase
            .from('client_contacts')
            .update({
              name: c.name,
              email: c.email,
              phone: c.phone,
              role: c.role,
              is_primary: idx === 0
            })
            .eq('id', c.id);
          if (updError) throw updError;
        }
      }

      onSuccess();
      onClose();
    } catch (err) {
      console.error('Error saving client:', err);
      toast.error('Erro ao salvar cliente.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal 
      isOpen={isOpen}
      onClose={onClose}
      title={client ? 'Editar Cliente' : 'Novo Cliente'}
      maxWidth="max-w-[min(95vw,1000px)]"
      padding="p-12"
      footer={
        <div className="flex justify-end gap-4 w-full">
          <button 
            onClick={onClose} 
            className="btn-secondary h-[52px] min-w-[160px] text-base"
          >
            Cancelar
          </button>
          <button 
            onClick={handleSave} 
            disabled={saving || !formData.name.trim()} 
            className="btn-primary px-8 h-[52px] min-w-[160px] text-base"
          >
            {saving ? 'Gravando...' : 'Salvar Cliente'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-8 max-h-[75vh] min-h-[400px] overflow-y-auto custom-scrollbar pr-2">
        <div className="flex flex-col gap-8">
          {/* Header overrides */}
          <style dangerouslySetInnerHTML={{ __html: `
            #modal-title { font-size: 22px !important; margin-bottom: 0 !important; font-weight: 900 !important; }
          `}} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex flex-col gap-2">
              <label className="text-[15px] font-medium text-lumos-text-secondary uppercase tracking-widest mb-2">Nome da Empresa</label>
              <input 
                required
                className="input-lumos w-full h-12 px-4 text-base"
                placeholder="Ex: Coca-Cola"
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[15px] font-medium text-lumos-text-secondary uppercase tracking-widest mb-2">Agência (Opcional)</label>
              <input 
                className="input-lumos w-full h-12 px-4 text-base"
                placeholder="Ex: WMcCann"
                value={formData.agency_name}
                onChange={(e) => setFormData({...formData, agency_name: e.target.value})}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[15px] font-medium text-lumos-text-secondary uppercase tracking-widest mb-2">Marcas (Opcional)</label>
            <p className="text-sm text-lumos-text-secondary -mt-1">
              Só para clientes com sub-marcas (ex.: Vitru → Uniasselvi, Continuada, Vitru). Cada projeto escolhe uma marca e a pasta do projeto no Drive fica em PROJETOS › marca; sem escolher, o projeto fica sem pasta. Deixe vazio se o cliente não tem marcas.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {marcas.map(m => (
                <span key={m} className="inline-flex items-center gap-1.5 rounded-full border border-lumos-border bg-lumos-bg px-3 py-1.5 text-sm font-bold text-lumos-text-primary">
                  {m}
                  <button type="button" onClick={() => setMarcas(marcas.filter(x => x !== m))} aria-label={`Remover a marca ${m}`} className="text-lumos-text-secondary hover:text-red-500">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                className="input-lumos h-12 px-4 text-base flex-1 max-w-sm"
                placeholder="Nome da marca"
                value={novaMarca}
                onChange={(e) => setNovaMarca(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); adicionarMarca(); } }}
              />
              <button type="button" onClick={adicionarMarca} disabled={!novaMarca.trim()} className="btn-secondary h-12 px-5 text-sm">Adicionar</button>
            </div>
            {client && marcasAntesRemovidas(client.marcas ?? [], marcas) && (
              <p className="text-xs text-amber-600 dark:text-amber-400">Remover uma marca não move nem apaga pastas que já existem no Drive.</p>
            )}
          </div>

          <div className="space-y-6 pt-4">
            <div className="flex items-center justify-between border-b border-lumos-border pb-4 mb-4">
              <h3 className="text-base font-black text-lumos-text-primary uppercase tracking-widest flex items-center gap-2">
                <Users className="w-5 h-5 text-lumos-yellow" />
                Contatos da Empresa
              </h3>
              <button 
                type="button"
                onClick={addContactRow}
                className="text-sm font-black uppercase text-lumos-yellow hover:underline flex items-center gap-1 bg-lumos-yellow/10 px-4 py-2 rounded-lumos transition-all"
              >
                <Plus className="w-4 h-4" />
                Adicionar Contato
              </button>
            </div>

            <div className="space-y-4 max-h-[450px] overflow-y-auto pt-3 pl-3 pr-2 custom-scrollbar">
              {contacts.map((contact, idx) => (
                <div key={idx} className={clsx(
                  "bg-lumos-bg/30 p-6 rounded-lumos border border-lumos-border grid grid-cols-1 md:grid-cols-12 gap-3 items-end relative group/contact",
                  idx > 0 && "mt-4 pt-6 border-t border-lumos-border/50"
                )}>
                  <div className="md:col-span-4">
                    <label className="block text-[11px] font-bold text-lumos-text-secondary uppercase mb-2">Nome</label>
                    <input 
                      className="input-lumos w-full h-11 px-4 text-[15px]"
                      value={contact.name}
                      onChange={(e) => updateContact(idx, 'name', e.target.value)}
                      placeholder="Nome completo"
                    />
                  </div>
                  <div className="md:col-span-3">
                    <label className="block text-[11px] font-bold text-lumos-text-secondary uppercase mb-2">E-mail</label>
                    <input 
                      className="input-lumos w-full h-11 px-4 text-[15px]"
                      value={contact.email}
                      onChange={(e) => updateContact(idx, 'email', e.target.value)}
                      placeholder="E-mail"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[11px] font-bold text-lumos-text-secondary uppercase mb-2">Telefone</label>
                    <input 
                      className="input-lumos w-full h-11 px-4 text-[15px]"
                      value={contact.phone}
                      onChange={(e) => updateContact(idx, 'phone', e.target.value)}
                      placeholder="Telefone"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[11px] font-bold text-lumos-text-secondary uppercase mb-2">Cargo</label>
                    <input 
                      className="input-lumos w-full h-11 px-4 text-[15px]"
                      value={contact.role}
                      onChange={(e) => updateContact(idx, 'role', e.target.value)}
                      placeholder="Cargo"
                    />
                  </div>
                  <div className="md:col-span-1 flex justify-center pb-1">
                    {contacts.length > 1 && (
                      <button 
                        type="button" 
                        onClick={() => removeContactRow(idx)}
                        className="p-2.5 text-lumos-text-secondary hover:text-red-500 hover:bg-red-500/10 rounded-full transition-all"
                      >
                        <Trash className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                  {idx === 0 && (
                    <span className="absolute -top-2 -left-2 bg-lumos-yellow text-black text-[9px] font-black px-[12px] py-[4px] rounded uppercase whitespace-nowrap shadow-sm z-20 inline-flex items-center justify-center">
                      Primário
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
