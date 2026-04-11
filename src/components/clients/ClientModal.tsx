import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Users, Plus, Trash, Building2 } from 'lucide-react';
import Modal from '@/components/common/Modal';

interface Client {
  id: string;
  name: string;
  agency_name?: string;
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

export default function ClientModal({ isOpen, onClose, onSuccess, client }: ClientModalProps) {
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    agency_name: '',
  });
  const [contacts, setContacts] = useState<ContactFormData[]>([
    { name: '', email: '', phone: '', role: '' }
  ]);

  useEffect(() => {
    if (isOpen) {
      if (client) {
        setFormData({
          name: client.name,
          agency_name: client.agency_name || '',
        });
        fetchContacts(client.id);
      } else {
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

      // 1. Save/Update Client
      if (client) {
        const { error } = await supabase.from('clients').update(formData).eq('id', clientId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('clients').insert(formData).select().single();
        if (error) throw error;
        clientId = data.id;
      }

      // 2. Save/Update Contacts
      if (clientId) {
        // Delete existing if editing
        if (client) {
          await supabase.from('client_contacts').delete().eq('client_id', clientId);
        }

        const contactsToInsert = contacts
          .filter(c => c.name.trim())
          .map((c, idx) => ({
            client_id: clientId,
            name: c.name,
            email: c.email,
            phone: c.phone,
            role: c.role,
            is_primary: idx === 0
          }));

        if (contactsToInsert.length > 0) {
          const { error: cError } = await supabase.from('client_contacts').insert(contactsToInsert);
          if (cError) throw cError;
        }
      }

      onSuccess();
      onClose();
    } catch (err) {
      console.error('Error saving client:', err);
      alert('Erro ao salvar cliente.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal 
      isOpen={isOpen}
      onClose={onClose}
      title={client ? 'Editar Cliente' : 'Novo Cliente'}
      className="max-w-[640px]"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button 
            onClick={handleSave} 
            disabled={saving || !formData.name.trim()} 
            className="btn-primary px-8"
          >
            {saving ? 'Gravando...' : 'Salvar Cliente'}
          </button>
        </>
      }
    >
      <form onSubmit={handleSave} className="space-y-8 max-h-[70vh] overflow-y-auto pr-2 custom-scrollbar">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-1">
          <div>
            <label className="block text-xs font-black text-lumos-text-secondary uppercase mb-2 tracking-widest">Nome da Empresa</label>
            <input 
              required
              className="input-lumos w-full h-11"
              placeholder="Ex: Coca-Cola"
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
            />
          </div>
          <div>
            <label className="block text-xs font-black text-lumos-text-secondary uppercase mb-2 tracking-widest">Agência (Opcional)</label>
            <input 
              className="input-lumos w-full h-11"
              placeholder="Ex: WMcCann"
              value={formData.agency_name}
              onChange={(e) => setFormData({...formData, agency_name: e.target.value})}
            />
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-lumos-border pb-2">
            <h3 className="text-xs font-black text-lumos-text-primary uppercase tracking-widest flex items-center gap-2">
              <Users className="w-4 h-4 text-lumos-yellow" />
              Contatos da Empresa
            </h3>
            <button 
              type="button"
              onClick={addContactRow}
              className="text-[10px] font-black uppercase text-lumos-yellow hover:underline flex items-center gap-1"
            >
              <Plus className="w-3 h-3" />
              Adicionar Contato
            </button>
          </div>

          <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
            {contacts.map((contact, idx) => (
              <div key={idx} className="bg-lumos-bg/30 p-4 rounded-lumos border border-lumos-border grid grid-cols-1 md:grid-cols-12 gap-4 items-end relative group/contact">
                <div className="md:col-span-3">
                  <label className="block text-[9px] font-black text-lumos-text-secondary uppercase mb-1">Nome</label>
                  <input 
                    className="input-lumos w-full h-9 text-sm"
                    value={contact.name}
                    onChange={(e) => updateContact(idx, 'name', e.target.value)}
                    placeholder="Nome"
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="block text-[9px] font-black text-lumos-text-secondary uppercase mb-1">E-mail</label>
                  <input 
                    className="input-lumos w-full h-9 text-sm"
                    value={contact.email}
                    onChange={(e) => updateContact(idx, 'email', e.target.value)}
                    placeholder="email@exemplo.com"
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="block text-[9px] font-black text-lumos-text-secondary uppercase mb-1">Telefone</label>
                  <input 
                    className="input-lumos w-full h-9 text-sm"
                    value={contact.phone}
                    onChange={(e) => updateContact(idx, 'phone', e.target.value)}
                    placeholder="(00) 00000-0000"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[9px] font-black text-lumos-text-secondary uppercase mb-1">Cargo</label>
                  <input 
                    className="input-lumos w-full h-9 text-sm"
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
                      className="p-2 text-lumos-text-secondary hover:text-red-500 hover:bg-red-500/10 rounded-full transition-all"
                    >
                      <Trash className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {idx === 0 && (
                  <span className="absolute -top-2 -left-2 bg-lumos-yellow text-black text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter">Primário</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </form>
    </Modal>
  );
}
