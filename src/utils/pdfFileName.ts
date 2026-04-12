import { formatBudgetCode } from './formatters';

/**
 * Generates a standardized filename for budget and OS PDFs.
 * Format: #[YEAR]-[CODE] | Lumos + [Agency + Client] | [Project Name].pdf
 */
export const getPdfFileName = (
  code: string, 
  clientName: string, 
  agencyName: string | null | undefined, 
  projectName: string,
  prefix: string = ''
): string => {
  const clientDisplayName = agencyName ? `${agencyName} + ${clientName}` : clientName;
  const formattedCode = formatBudgetCode(code);
  
  return `${prefix}${formattedCode} | Lumos + ${clientDisplayName} | ${projectName}.pdf`;
};
