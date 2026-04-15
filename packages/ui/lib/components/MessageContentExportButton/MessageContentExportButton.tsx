import React, { useState } from 'react';
import { t } from '@extension/i18n';
import { cn } from '../../utils';

export interface MessageContentExportButtonProps {
  content: string;
  filename?: string;
  isDarkMode?: boolean;
  className?: string;
}

export const MessageContentExportButton: React.FC<MessageContentExportButtonProps> = ({
  content,
  filename = 'message-export',
  isDarkMode = true,
  className = '',
}) => {
  const [isExporting, setIsExporting] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const handleExportMD = async () => {
    if (!content) return;

    setIsExporting(true);
    try {
      // Create markdown file blob
      const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
      downloadBlob(blob, `${filename}.md`);
    } catch (error) {
      console.error('Export MD failed:', error);
    } finally {
      setIsExporting(false);
      setShowDropdown(false);
    }
  };

  const handleExportPDF = async () => {
    if (!content) return;

    setIsExporting(true);
    try {
      // Use browser print to PDF functionality
      // Create a temporary window with styled content
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert('无法打开打印窗口，请检查浏览器弹窗设置');
        setIsExporting(false);
        return;
      }

      // Create styled HTML content for printing
      const htmlContent = generatePrintableHTML(content, isDarkMode);
      printWindow.document.write(htmlContent);
      printWindow.document.close();

      // Wait for content to load then trigger print
      setTimeout(() => {
        printWindow.print();
        setIsExporting(false);
        setShowDropdown(false);
      }, 500);
    } catch (error) {
      console.error('Export PDF failed:', error);
      setIsExporting(false);
      setShowDropdown(false);
    }
  };

  if (!content) {
    return null;
  }

  return (
    <div className={cn('message-content-export-container', className)}>
      <button
        className={cn(
          'message-content-export-button',
          isDarkMode ? 'message-content-export-button--dark' : 'message-content-export-button--light',
        )}
        onClick={() => setShowDropdown(!showDropdown)}
        disabled={isExporting}
        title={t('content_export_title')}
        type="button">
        <svg className="export-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      </button>

      {showDropdown && (
        <div
          className={cn(
            'message-content-export-dropdown',
            isDarkMode ? 'message-content-export-dropdown--dark' : 'message-content-export-dropdown--light',
          )}>
          <button onClick={handleExportMD} type="button" disabled={isExporting}>
            <span className="format-icon">📝</span> {t('content_export_md')}
          </button>
          <button onClick={handleExportPDF} type="button" disabled={isExporting}>
            <span className="format-icon">📄</span> {t('content_export_pdf')}
          </button>
        </div>
      )}
    </div>
  );
};

// Helper: Generate printable HTML from markdown content
function generatePrintableHTML(markdown: string, isDarkMode: boolean): string {
  // Basic styling for print
  const styles = `
    @media print {
      body { font-size: 12pt; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
      th { background-color: #f5f5f5; }
      pre { background: #f5f5f5; padding: 10px; overflow-x: auto; }
      code { background: #f5f5f5; padding: 2px 4px; }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      max-width: 800px;
      margin: 40px auto;
      padding: 20px;
      color: ${isDarkMode ? '#e6e6e6' : '#333'};
      background: ${isDarkMode ? '#1a1a1a' : '#fff'};
    }
    h1, h2, h3, h4, h5, h6 { margin-top: 24px; margin-bottom: 16px; font-weight: 600; }
    h1 { font-size: 2em; border-bottom: 1px solid ${isDarkMode ? '#3a3a3a' : '#eee'}; }
    h2 { font-size: 1.5em; }
    h3 { font-size: 1.25em; }
    p { margin: 16px 0; }
    a { color: #58a6ff; }
    blockquote {
      border-left: 4px solid #58a6ff;
      margin: 16px 0;
      padding: 0 16px;
      background: ${isDarkMode ? 'rgba(88,166,255,0.1)' : 'rgba(88,166,255,0.05)'};
    }
    ul, ol { margin: 16px 0; padding-left: 2em; }
    li { margin: 4px 0; }
    table { margin: 16px 0; }
    th, td { border: 1px solid ${isDarkMode ? '#3a3a3a' : '#ddd'}; padding: 8px 12px; }
    th { background: ${isDarkMode ? '#2a2a2a' : '#f5f5f5'}; }
    pre {
      background: ${isDarkMode ? '#1e1e1e' : '#f6f8fa'};
      padding: 16px;
      border-radius: 6px;
      overflow-x: auto;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
    }
    code {
      background: ${isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'};
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
    }
    pre code { background: none; padding: 0; }
  `;

  // Simple markdown to HTML conversion
  const html = convertMarkdownToHTML(markdown);

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Export Content</title>
      <style>${styles}</style>
    </head>
    <body>
      ${html}
    </body>
    </html>
  `;
}

// Simple markdown to HTML converter
function convertMarkdownToHTML(markdown: string): string {
  let html = markdown;

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Code blocks
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

  // Unordered lists
  html = html.replace(/^\- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Tables (basic)
  html = html.replace(/\|(.+)\|\n\|[-\s|:]+\|\n((?:\|.+\|\n?)+)/g, (match: string, header: string, body: string) => {
    const headers = header
      .split('|')
      .map((h: string) => h.trim())
      .filter(Boolean)
      .map((h: string) => `<th>${h}</th>`)
      .join('');
    const rows = body
      .trim()
      .split('\n')
      .map((row: string) =>
        row
          .split('|')
          .map((c: string) => c.trim())
          .filter(Boolean)
          .map((c: string) => `<td>${c}</td>`)
          .join(''),
      )
      .map((r: string) => `<tr>${r}</tr>`)
      .join('');
    return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
  });

  // Paragraphs (lines not already wrapped)
  html = html
    .split('\n\n')
    .map(line => {
      if (line.trim() && !line.match(/^<[hulotbp]/)) {
        return `<p>${line}</p>`;
      }
      return line;
    })
    .join('\n');

  return html;
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

export default MessageContentExportButton;
