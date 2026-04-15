import React, { useMemo, useState } from 'react';
import { exportMultipleTables, extractTablesFromMarkdown, type ExportFormat } from '@extension/shared';
import { t } from '@extension/i18n';
import { cn } from '../../utils';

export interface MessageExportButtonProps {
  content: string;
  filename?: string;
  isDarkMode?: boolean;
  className?: string;
}

export const MessageExportButton: React.FC<MessageExportButtonProps> = ({
  content,
  filename = 'tables-export',
  isDarkMode = true,
  className = '',
}) => {
  const [isExporting, setIsExporting] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  // Extract tables from markdown content
  const tables = useMemo(() => extractTablesFromMarkdown(content), [content]);

  const handleExport = async (format: ExportFormat) => {
    if (!tables || tables.length === 0) {
      return;
    }

    setIsExporting(true);
    try {
      if (format === 'xlsx') {
        // Export all tables to one Excel file with multiple sheets
        await exportMultipleTables(tables, `${filename}.xlsx`);
      } else {
        // For CSV/HTML, export each table separately
        for (const table of tables) {
          await exportToExcelFormat(table.data, `${table.name}.${format}`, format);
        }
      }
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setIsExporting(false);
      setShowDropdown(false);
    }
  };

  // Simple export function for single format
  const exportToExcelFormat = async (data: string[][], name: string, format: ExportFormat) => {
    // Dynamic import to avoid circular dependency issues
    const { exportToExcel } = await import('@extension/shared');
    await exportToExcel(data, { filename: name, format });
  };

  // Don't show button if no tables in content
  if (!tables || tables.length === 0) {
    return null;
  }

  return (
    <div className={cn('message-export-container', className)}>
      <button
        className={cn(
          'message-export-button',
          isDarkMode ? 'message-export-button--dark' : 'message-export-button--light',
        )}
        onClick={() => setShowDropdown(!showDropdown)}
        disabled={isExporting}
        title={t('message_export_title', [String(tables.length)])}
        type="button">
        <svg className="export-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7,10 12,15 17,10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        <span className="export-count">{tables.length}</span>
      </button>

      {showDropdown && (
        <div
          className={cn(
            'message-export-dropdown',
            isDarkMode ? 'message-export-dropdown--dark' : 'message-export-dropdown--light',
          )}>
          <div className="dropdown-header">{t('message_export_header', [String(tables.length)])}</div>
          <button onClick={() => handleExport('xlsx')} type="button" disabled={isExporting}>
            <span className="format-icon">📊</span> {t('message_export_excel_multi')}
          </button>
          <button onClick={() => handleExport('csv')} type="button" disabled={isExporting}>
            <span className="format-icon">📄</span> {t('message_export_csv_separate')}
          </button>
          <button onClick={() => handleExport('html')} type="button" disabled={isExporting}>
            <span className="format-icon">🌐</span> {t('message_export_html_separate')}
          </button>
        </div>
      )}
    </div>
  );
};

export default MessageExportButton;
