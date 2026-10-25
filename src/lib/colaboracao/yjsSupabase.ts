import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { supabase } from '@/lib/supabase';

/**
 * Texto colaborativo (estilo Google Docs) sobre o Supabase.
 *
 * - O texto vive num documento Yjs (CRDT): cada pessoa edita o seu, e as edições se juntam sozinhas,
 *   sem sobrescrever ninguém, mesmo digitando ao mesmo tempo no mesmo parágrafo.
 * - As edições (e os cursores) viajam entre os navegadores pelo canal de Broadcast do Realtime.
 * - O estado completo é guardado na tabela `doc_states`, para quem abre depois (e para o texto não
 *   se perder se todo mundo fechar). A gravação nunca diminui o estado: antes de gravar, junta o que
 *   já está lá, e só grava se ninguém gravou no meio (controle de versão).
 */

const paraBase64 = (u: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const deBase64 = (b: string) => Uint8Array.from(atob(b), c => c.charCodeAt(0));

export interface UsuarioDoCursor { nome: string; cor: string }

export class ProvedorYjsSupabase {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  private canal: ReturnType<typeof supabase.channel> | null = null;
  private timerGravacao: number | null = null;
  private gravando = false;
  private destruido = false;
  private versaoGravada = 0;
  /** Chamado depois de cada gravação bem-sucedida (para espelhar o HTML na coluna original). */
  aoGravar: (() => void | Promise<void>) | null = null;

  constructor(readonly chave: string, doc: Y.Doc, usuario: UsuarioDoCursor) {
    this.doc = doc;
    this.awareness = new Awareness(doc);
    this.awareness.setLocalStateField('user', usuario);
    doc.on('update', this.aoMudarDoc);
    this.awareness.on('update', this.aoMudarPresenca);
  }

  // ── estado guardado ─────────────────────────────────────────────────────
  /** Lê o estado guardado: aplica no documento e devolve a versão (0 = ainda não existe). */
  async carregar(): Promise<number> {
    const { data, error } = await supabase.from('doc_states').select('estado, versao').eq('chave', this.chave).maybeSingle();
    // Tabela ainda não criada (SQL pendente) ou sem permissão: quem chamou usa o editor comum.
    if (error) throw new Error(`doc_states indisponível: ${error.message}`);
    if (data?.estado) {
      Y.applyUpdate(this.doc, deBase64(data.estado), this);
      this.versaoGravada = data.versao;
      return data.versao;
    }
    return 0;
  }

  /**
   * Cria o estado inicial a partir de um documento já montado (com o texto que existia antes).
   * Só uma pessoa consegue (o primeiro a gravar vence); quem perde simplesmente lê o estado do vencedor,
   * para não termos dois "textos iniciais" diferentes que se somariam duplicados.
   */
  static async semear(chave: string, estadoInicial: Uint8Array): Promise<void> {
    const { error } = await supabase.from('doc_states').upsert({ chave, estado: paraBase64(estadoInicial), versao: 1 }, { onConflict: 'chave', ignoreDuplicates: true });
    if (error) throw new Error(`não foi possível criar o estado do texto: ${error.message}`);
  }

  private agendarGravacao() {
    if (this.timerGravacao) window.clearTimeout(this.timerGravacao);
    this.timerGravacao = window.setTimeout(() => { this.timerGravacao = null; void this.gravar(); }, 1500);
  }

  /** Grava o estado completo, juntando antes o que outras pessoas já gravaram. */
  async gravar(): Promise<void> {
    if (this.gravando || this.destruido) return;
    this.gravando = true;
    try {
      for (let tentativa = 0; tentativa < 4; tentativa++) {
        const { data } = await supabase.from('doc_states').select('estado, versao').eq('chave', this.chave).maybeSingle();
        if (data?.estado) Y.applyUpdate(this.doc, deBase64(data.estado), this);   // o nosso passa a conter o que está lá
        const versao = data?.versao ?? 0;
        const estado = paraBase64(Y.encodeStateAsUpdate(this.doc));
        if (!data) {
          const r = await supabase.from('doc_states').upsert({ chave: this.chave, estado, versao: 1 }, { onConflict: 'chave', ignoreDuplicates: true }).select('versao');
          if ((r.data?.length ?? 0) > 0) { this.versaoGravada = 1; await this.aoGravar?.(); return; }
          continue;
        }
        const r = await supabase.from('doc_states').update({ estado, versao: versao + 1, atualizado_em: new Date().toISOString() })
          .eq('chave', this.chave).eq('versao', versao).select('versao');
        if ((r.data?.length ?? 0) > 0) { this.versaoGravada = versao + 1; await this.aoGravar?.(); return; }
        // Alguém gravou no meio: tenta de novo já com o que ele gravou.
      }
    } finally {
      this.gravando = false;
    }
  }

  // ── tempo real ──────────────────────────────────────────────────────────
  /** Entra no canal e pede às pessoas que estão aqui o que elas já têm. */
  conectar(): Promise<void> {
    if (this.destruido) return Promise.resolve();
    return new Promise(resolve => {
      const canal = supabase.channel(`y:${this.chave}`, { config: { broadcast: { self: false } } });
      this.canal = canal;
      canal.on('broadcast', { event: 'u' }, ({ payload }) => { Y.applyUpdate(this.doc, deBase64(payload.u), this); });
      canal.on('broadcast', { event: 'a' }, ({ payload }) => { applyAwarenessUpdate(this.awareness, deBase64(payload.a), this); });
      canal.on('broadcast', { event: 'p' }, ({ payload }) => {
        // Alguém acabou de entrar e pediu o que falta: responde com o que ele não tem, e diz onde estão os cursores.
        const faltando = Y.encodeStateAsUpdate(this.doc, deBase64(payload.sv));
        canal.send({ type: 'broadcast', event: 'u', payload: { u: paraBase64(faltando) } });
        this.enviarPresenca([this.doc.clientID]);
      });
      canal.subscribe(status => {
        if (status === 'SUBSCRIBED') {
          // Entrou (ou reconectou): pede o que faltou e avisa onde está.
          canal.send({ type: 'broadcast', event: 'p', payload: { sv: paraBase64(Y.encodeStateVector(this.doc)) } });
          this.enviarPresenca([this.doc.clientID]);
          resolve();
        }
      });
    });
  }

  private enviarPresenca(clientes: number[]) {
    if (!this.canal || this.destruido) return;
    this.canal.send({ type: 'broadcast', event: 'a', payload: { a: paraBase64(encodeAwarenessUpdate(this.awareness, clientes)) } });
  }

  private aoMudarDoc = (atualizacao: Uint8Array, origem: unknown) => {
    if (origem === this || this.destruido) return;     // veio de fora: já está em todos
    this.canal?.send({ type: 'broadcast', event: 'u', payload: { u: paraBase64(atualizacao) } });
    this.agendarGravacao();
  };

  private aoMudarPresenca = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origem: unknown) => {
    if (origem === this) return;
    this.enviarPresenca([...added, ...updated, ...removed]);
  };

  /** Grava o que faltar e solta tudo (ao fechar o texto). */
  async destruir(): Promise<void> {
    if (this.destruido) return;
    const pendente = this.timerGravacao !== null;
    if (this.timerGravacao) window.clearTimeout(this.timerGravacao);
    if (pendente) await this.gravar();
    this.destruido = true;
    this.doc.off('update', this.aoMudarDoc);
    this.awareness.off('update', this.aoMudarPresenca);
    removeAwarenessStates(this.awareness, [this.doc.clientID], 'saida');
    this.awareness.destroy();
    if (this.canal) supabase.removeChannel(this.canal);
  }
}
