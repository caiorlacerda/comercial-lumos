// Iniciais de nomes de pessoas para avatares.
// `palavra[0]` pega só a primeira UNIDADE UTF-16: num nome com emoji no fim (ex.: "Robô de Testes 🤖")
// devolve metade do emoji e aparece "�". `inicial` olha o primeiro caractere inteiro e só aceita letra ou número;
// emoji, símbolo e pontuação não viram inicial.
export const inicial = (palavra?: string | null): string => {
  const c = Array.from(palavra || '')[0] || '';
  return /[\p{L}\p{N}]/u.test(c) ? c : '';
};
