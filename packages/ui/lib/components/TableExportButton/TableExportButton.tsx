import React, { useState } from 'react';
import { exportToExcel, type ExportFormat } from '@extension/shared';
import { t } from '@extension/i18n';
import { cn } from '../../utils';

export interface TableExportButtonProps {
  tableData: string[][];
  filename?: string;
  isDarkMode?: boolean;
  className?: string;
}

export const TableExportButton: React.FC<TableExportButtonProps> = ({
  tableData,
  filename = 'table-export',
  isDarkMode = true,
  className = '',
}) => {
  const [isExporting, setIsExporting] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const handleExport = async (format: ExportFormat) => {
    if (!tableData || tableData.length === 0) {
      return;
    }

    setIsExporting(true);
    try {
      await exportToExcel(tableData, {
        filename: `${filename}.${format}`,
        format,
      });
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setIsExporting(false);
      setShowDropdown(false);
    }
  };

  if (!tableData || tableData.length === 0) {
    return null;
  }

  return (
    <div className={cn('table-export-container', className)}>
      <button
        className={cn('table-export-button', isDarkMode ? 'table-export-button--dark' : 'table-export-button--light')}
        onClick={() => setShowDropdown(!showDropdown)}
        disabled={isExporting}
        title={t('table_export_title')}
        type="button">
        <svg className="export-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7,10 12,15 17,10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </button>

      {showDropdown && (
        <div
          className={cn(
            'table-export-dropdown',
            isDarkMode ? 'table-export-dropdown--dark' : 'table-export-dropdown--light',
          )}>
          <button onClick={() => handleExport('xlsx')} type="button" disabled={isExporting}>
            <span className="format-icon">📊</span> {t('table_export_excel')}
          </button>
          <button onClick={() => handleExport('csv')} type="button" disabled={isExporting}>
            <span className="format-icon">📄</span> {t('table_export_csv')}
          </button>
          <button onClick={() => handleExport('html')} type="button" disabled={isExporting}>
            <span className="format-icon">🌐</span> {t('table_export_html')}
          </button>
        </div>
      )}
    </div>
  );
};

export default TableExportButton;
