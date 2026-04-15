import * as XLSX from 'xlsx';

export type ExportFormat = 'xlsx' | 'csv' | 'html';

export interface ExportOptions {
  filename: string;
  format: ExportFormat;
  sheetName?: string;
}

export interface TableData {
  data: string[][];
  name: string;
}

/**
 * Exports tabular data to Excel, CSV, or HTML format
 */
export async function exportToExcel(data: string[][], options: ExportOptions): Promise<void> {
  const { filename, format, sheetName = 'Sheet1' } = options;

  if (!data || data.length === 0) {
    throw new Error('No data to export');
  }

  // Create workbook and worksheet
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(data);

  // Auto-size columns
  const colWidths = calculateColumnWidths(data);
  worksheet['!cols'] = colWidths;

  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  // Generate and download file based on format
  if (format === 'csv') {
    const csvOutput = XLSX.utils.sheet_to_csv(worksheet);
    downloadFile(csvOutput, filename, 'text/csv;charset=utf-8');
  } else if (format === 'html') {
    const htmlOutput = XLSX.utils.sheet_to_html(worksheet);
    downloadFile(htmlOutput, filename, 'text/html;charset=utf-8');
  } else {
    // xlsx format
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    downloadBlob(blob, filename);
  }
}

/**
 * Export multiple tables to separate sheets in one Excel file
 */
export async function exportMultipleTables(tables: TableData[], filename: string): Promise<void> {
  if (!tables || tables.length === 0) {
    throw new Error('No tables to export');
  }

  const workbook = XLSX.utils.book_new();

  tables.forEach(({ data, name }) => {
    if (data && data.length > 0) {
      const worksheet = XLSX.utils.aoa_to_sheet(data);
      worksheet['!cols'] = calculateColumnWidths(data);
      // Excel sheet name limit is 31 characters
      const safeName = name.slice(0, 31);
      XLSX.utils.book_append_sheet(workbook, worksheet, safeName);
    }
  });

  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  downloadBlob(blob, filename);
}

/**
 * Extract tables from markdown content
 * Returns array of table data (headers + rows)
 */
export function extractTablesFromMarkdown(markdown: string): TableData[] {
  const tableRegex = /\|(.+)\|\n\|[-\s|:]+\|\n((?:\|.+\|\n?)+)/g;
  const tables: TableData[] = [];

  let match;
  let tableIndex = 1;
  while ((match = tableRegex.exec(markdown)) !== null) {
    const headerRow = match[1]
      .split('|')
      .map(cell => cell.trim())
      .filter(Boolean);

    const bodyRows = match[2]
      .trim()
      .split('\n')
      .map(row =>
        row
          .split('|')
          .map(cell => cell.trim())
          .filter(Boolean),
      )
      .filter(row => row.length > 0);

    tables.push({
      data: [headerRow, ...bodyRows],
      name: `Table ${tableIndex}`,
    });
    tableIndex++;
  }

  return tables;
}

// Helper: Calculate column widths based on content
function calculateColumnWidths(data: string[][]): { wch: number }[] {
  if (!data.length) return [];

  const maxWidths: number[] = [];

  data.forEach(row => {
    row.forEach((cell, colIndex) => {
      const length = String(cell).length;
      maxWidths[colIndex] = Math.max(maxWidths[colIndex] || 10, Math.min(length, 50)); // Cap at 50
    });
  });

  return maxWidths.map(w => ({ wch: w + 2 })); // Add padding
}

// Helper: Trigger file download for Blob
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Helper: Trigger file download for string content
function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  downloadBlob(blob, filename);
}
