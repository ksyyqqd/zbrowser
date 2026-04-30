import React, { useMemo, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { Components } from 'react-markdown';
import { cn } from '../../utils';
import { TableExportButton } from '../TableExportButton';

export interface MarkdownRendererProps {
  content: string;
  isDarkMode?: boolean;
  className?: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, isDarkMode = true, className = '' }) => {
  // Track table index during rendering
  const tableIndexRef = useRef(0);

  // Extract tables from markdown for export functionality
  const tables = useMemo(() => extractTables(content), [content]);

  // Reset table index when content changes
  useMemo(() => {
    tableIndexRef.current = 0;
  }, [content]);

  // Get current table and increment index
  const getNextTable = useCallback(() => {
    const index = tableIndexRef.current;
    tableIndexRef.current += 1;
    return tables[index] || [];
  }, [tables]);

  const components: Components = useMemo(
    () => ({
      // Custom table rendering with export button
      table: ({ children, ...props }) => {
        const currentTableData = getNextTable();
        return (
          <div className="markdown-table-wrapper">
            <TableExportButton tableData={currentTableData} isDarkMode={isDarkMode} />
            <table className="markdown-table" {...props}>
              {children}
            </table>
          </div>
        );
      },

      // Code block styling
      pre: ({ children, ...props }) => (
        <pre className="markdown-pre" {...props}>
          {children}
        </pre>
      ),

      code: ({ className: codeClassName, children, ...props }) => {
        const match = /language-(\w+)/.exec(codeClassName || '');
        const language = match ? match[1] : '';

        // Inline code vs code block
        const isInline = !codeClassName;

        if (isInline) {
          return (
            <code className="markdown-code-inline" {...props}>
              {children}
            </code>
          );
        }

        return (
          <div className="markdown-code-block">
            {language && <span className="markdown-code-language">{language}</span>}
            <code className={codeClassName} {...props}>
              {children}
            </code>
          </div>
        );
      },

      // Links open in new tab for security
      a: ({ href, children, ...props }) => (
        <a href={href} target="_blank" rel="noopener noreferrer" className="markdown-link" {...props}>
          {children}
        </a>
      ),

      // Styled headers
      h1: ({ children, ...props }) => (
        <h1 className="markdown-h1" {...props}>
          {children}
        </h1>
      ),
      h2: ({ children, ...props }) => (
        <h2 className="markdown-h2" {...props}>
          {children}
        </h2>
      ),
      h3: ({ children, ...props }) => (
        <h3 className="markdown-h3" {...props}>
          {children}
        </h3>
      ),
      h4: ({ children, ...props }) => (
        <h4 className="markdown-h4" {...props}>
          {children}
        </h4>
      ),
      h5: ({ children, ...props }) => (
        <h5 className="markdown-h5" {...props}>
          {children}
        </h5>
      ),
      h6: ({ children, ...props }) => (
        <h6 className="markdown-h6" {...props}>
          {children}
        </h6>
      ),

      // Styled blockquote
      blockquote: ({ children, ...props }) => (
        <blockquote className="markdown-blockquote" {...props}>
          {children}
        </blockquote>
      ),

      // Styled lists
      ul: ({ children, ...props }) => (
        <ul className="markdown-list" {...props}>
          {children}
        </ul>
      ),
      ol: ({ children, ...props }) => (
        <ol className="markdown-list-ordered" {...props}>
          {children}
        </ol>
      ),
      li: ({ children, ...props }) => (
        <li className="markdown-list-item" {...props}>
          {children}
        </li>
      ),

      // Paragraph
      p: ({ children, ...props }) => (
        <p className="markdown-paragraph" {...props}>
          {children}
        </p>
      ),

      // Strong and emphasis
      strong: ({ children, ...props }) => (
        <strong className="markdown-strong" {...props}>
          {children}
        </strong>
      ),
      em: ({ children, ...props }) => (
        <em className="markdown-emphasis" {...props}>
          {children}
        </em>
      ),

      // Horizontal rule
      hr: ({ ...props }) => <hr className="markdown-hr" {...props} />,

      // Image rendering - support base64 and regular URLs
      img: ({ src, alt, ...props }) => (
        <img
          src={src}
          alt={alt || 'Image'}
          className="markdown-image max-w-full rounded-lg shadow-md my-2"
          loading="lazy"
          {...props}
        />
      ),
    }),
    [getNextTable, isDarkMode],
  );

  return (
    <div className={cn('markdown-container', isDarkMode ? 'markdown-dark' : 'markdown-light', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
};

// Helper function to extract tables from markdown as string[][] (for export)
function extractTables(markdown: string): string[][][] {
  const tableRegex = /\|(.+)\|\n\|[-\s|:]+\|\n((?:\|.+\|\n?)+)/g;
  const tables: string[][][] = [];

  let match;
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

    tables.push([headerRow, ...bodyRows]);
  }

  return tables;
}

export default MarkdownRenderer;
