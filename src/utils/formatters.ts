export function formatBudgetCode(code: string): string {
  if (!code) return '';
  
  // Remove existing hash if any to normalize
  let cleanCode = code.startsWith('#') ? code.slice(1) : code;
  
  const currentYear = new Date().getFullYear();
  
  // If it already has a hyphen, we assume it has the year (e.g., 2026-201)
  if (cleanCode.includes('-')) {
    return `#${cleanCode}`;
  }
  
  // Otherwise, if it's just a number, prepend year and hash
  return `#${currentYear}-${cleanCode}`;
}
