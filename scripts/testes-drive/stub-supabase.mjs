// Supabase falso em memória: só o que a drive-provision usa. As tabelas ficam em globalThis.__db.
export function createClient() {
  const db = globalThis.__db;
  // ilike: % vira qualquer coisa, _ vira um caractere; \% e \_ são literais (como no Postgres)
  const ilike = (v, pad) => new RegExp('^' + pad.replace(/\\(.)|([%_])|([.*+?^${}()|[\]\\])/g, (_, lit, cur, esp) => lit ? lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : cur === '%' ? '.*' : cur === '_' ? '.' : '\\' + esp) + '$', 'i').test(String(v ?? ''));
  const filtra = (rows, filtros) => rows.filter(r => filtros.every(([k, v, tipo]) => tipo === 'ilike' ? ilike(r[k], v) : r[k] === v));
  return {
    from(tabela) {
      const rows = () => db[tabela] ?? (db[tabela] = []);
      return {
        select(cols) {
          const filtros = []; let lim = Infinity;
          const q = {
            eq(k, v) { filtros.push([k, v]); return q; },
            ilike(k, v) { filtros.push([k, v, 'ilike']); return q; },
            limit(n) { lim = n; return q; },
            _linhas() { return filtra(rows(), filtros).slice(0, lim); },
            _com(r) {
              const o = { ...r };
              if (tabela === 'projects' && /client:clients/.test(cols)) {
                const c = (db.clients || []).find(x => x.id === r.client_id);
                o.client = c ? { id: c.id, name: c.name, drive_folder_id: c.drive_folder_id } : null;
                o.budget = null;
              }
              if (tabela === 'video_versions' && /project:projects/.test(cols)) o.project = (db.projects || []).find(x => x.id === r.project_id) ?? null;
              if (tabela === 'clients' && cols === 'marcas' && !('marcas' in r)) return { error: { message: 'column marcas does not exist' } };
              return o;
            },
            async single() { const r = q._linhas()[0]; if (!r) return { data: null, error: { message: 'nao achou' } }; const o = q._com(r); return o.error ? { data: null, error: o.error } : { data: o, error: null }; },
            then(res, rej) { return Promise.resolve({ data: q._linhas().map(r => q._com(r)), error: null }).then(res, rej); },
          };
          return q;
        },
        update(patch) {
          const filtros = []; let querLinhas = false;
          const q = {
            eq(k, v) { filtros.push([k, v]); return q; },
            select() { querLinhas = true; return q; },
            then(res, rej) { const alvo = filtra(rows(), filtros); alvo.forEach(r => Object.assign(r, patch)); return Promise.resolve({ data: querLinhas ? alvo.map(r => ({ id: r.id })) : null, error: null }).then(res, rej); },
          };
          return q;
        },
        async insert(novos) { rows().push(...(Array.isArray(novos) ? novos : [novos])); return { error: null }; },
      };
    },
  };
}
