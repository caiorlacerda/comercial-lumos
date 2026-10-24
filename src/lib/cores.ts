/** Texto escuro sobre cor clara e branco sobre cor escura (luminância de uma cor hex). */
export const textoSobre = (hex: string) => {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#161616' : '#ffffff';
};
