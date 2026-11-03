// Hook de resolução do Node: troca os imports por URL da edge function (deno.land, esm.sh) por stubs locais.
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('https://deno.land/std')) return { url: new URL('./stub-serve.mjs', import.meta.url).href, shortCircuit: true };
  if (specifier.startsWith('https://esm.sh/@supabase/supabase-js')) return { url: new URL('./stub-supabase.mjs', import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
