import { supabase } from '@/lib/supabase';

export async function runClientMigration() {
  console.log('Starting client migration...');
  
  try {
    // 1. Fetch all existing clients
    const { data: allClients, error: fetchError } = await supabase
      .from('clients')
      .select('*')
      .order('name');
      
    if (fetchError) throw fetchError;
    if (!allClients || allClients.length === 0) {
      return { success: true, message: 'No clients found to migrate.' };
    }

    // 2. Group by normalized name (lowercase, trimmed)
    const groups: Record<string, any[]> = {};
    allClients.forEach(client => {
      const key = client.name.trim().toLowerCase();
      if (!groups[key]) groups[key] = [];
      groups[key].push(client);
    });

    let stats = {
      totalBefore: allClients.length,
      totalGroups: Object.keys(groups).length,
      contactsCreated: 0,
      budgetsRebound: 0
    };

    for (const nameKey in groups) {
      const cluster = groups[nameKey];
      // Use the first one as "Master"
      const master = cluster[0];
      const others = cluster.slice(1);

      // 3. For every client in the cluster, extract contact info into client_contacts
      const existingContacts = new Set();
      for (const client of cluster) {
        const contactKey = `${client.contact_name?.toLowerCase()}|${client.email?.toLowerCase()}`;
        
        if (client.contact_name && !existingContacts.has(contactKey)) {
          const { error: contactError } = await supabase
            .from('client_contacts')
            .insert({
              client_id: master.id,
              name: client.contact_name,
              email: client.email,
              phone: client.phone,
              is_primary: client.id === master.id // Only primary if it was the master
            });
          
          if (!contactError) {
            stats.contactsCreated++;
            existingContacts.add(contactKey);
          }
        }

        // 4. Rebind budgets from duplicate clients to the master client
        if (client.id !== master.id) {
          const { data: rebound, error: rebError } = await supabase
            .from('budgets')
            .update({ client_id: master.id })
            .eq('client_id', client.id)
            .select();
            
          if (!rebError && rebound) stats.budgetsRebound += rebound.length;
        }
      }

      // 5. Delete duplicate client records (keeping only the master)
      if (others.length > 0) {
        const otherIds = others.map(o => o.id);
        const { error: delError } = await supabase
          .from('clients')
          .delete()
          .in('id', otherIds);
          
        if (delError) console.error(`Error deleting duplicate clients for ${master.name}:`, delError);
      }
    }

    return { 
      success: true, 
      message: `Migração concluída com sucesso!`, 
      stats 
    };
  } catch (err) {
    console.error('Migration failed:', err);
    return { success: false, error: err };
  }
}
