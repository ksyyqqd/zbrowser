import { memo, useEffect, useRef, useState } from 'react';
import { FiChevronDown, FiClock, FiAlertCircle } from 'react-icons/fi';
import { requestLogStore, type AgentRequestLogEntry } from '@extension/storage';

interface RequestLogPanelProps {
  taskId: string | null;
  isDarkMode?: boolean;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour12: false });
}

function LogBlock({ label, content }: { label: string; content: string }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{label}</div>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/[0.03] p-2 text-[11px] leading-relaxed text-[color:var(--text-secondary)]">
        {content}
      </pre>
    </div>
  );
}

function LogItem({ log, isDarkMode }: { log: AgentRequestLogEntry; isDarkMode: boolean }) {
  const hasError = log.parseStatus === 'failed';
  return (
    <details
      className="group rounded-lg border px-3 py-2"
      style={{
        borderColor: isDarkMode ? 'rgba(116,198,157,0.14)' : 'rgba(139,115,85,0.12)',
        background: isDarkMode ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.56)',
      }}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm">
        <div className="min-w-0">
          <div className="truncate font-medium" style={{ color: 'var(--text-primary)' }}>
            {log.agent} / {log.phase}
          </div>
          <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            <FiClock size={11} />
            <span>{formatTime(log.createdAt)}</span>
            <span>·</span>
            <span>{log.modelName}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px]" style={{ color: hasError ? '#ef4444' : '#40916C' }}>
          {hasError ? <FiAlertCircle size={12} /> : null}
          <span>{log.parseStatus === 'success' ? '解析成功' : '解析失败'}</span>
          <FiChevronDown size={14} className="transition-transform group-open:rotate-180" />
        </div>
      </summary>

      <div className="mt-3 space-y-3">
        <LogBlock label="发送内容" content={log.requestContent || '(empty)'} />
        <LogBlock label="响应内容" content={log.responseContent || '(empty)'} />
        <LogBlock label="解析状态" content={log.error ? `${log.parseStatus}\n${log.error}` : log.parseStatus} />
      </div>
    </details>
  );
}

export default memo(function RequestLogPanel({ taskId, isDarkMode = false }: RequestLogPanelProps) {
  const [logs, setLogs] = useState<AgentRequestLogEntry[]>([]);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!taskId) {
      setLogs([]);
      return;
    }

    let active = true;
    const refresh = async () => {
      const nextLogs = await requestLogStore.getByTaskId(taskId);
      if (active) {
        setLogs(nextLogs);
      }
    };

    void refresh();
    const unsubscribe = requestLogStore.subscribe(() => {
      void refresh();
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [taskId]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs]);

  if (!taskId || logs.length === 0) {
    return null;
  }

  return (
    <div
      className="rounded-2xl border p-3"
      style={{
        borderColor: isDarkMode ? 'rgba(116,198,157,0.16)' : 'rgba(139,115,85,0.14)',
        background: isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.7)',
      }}>
      <div className="mb-2 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            请求日志
          </div>
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            记录发送内容、响应内容和解析状态
          </div>
        </div>
        <span
          className="rounded-full px-2 py-0.5 text-[10px]"
          style={{
            background: isDarkMode ? 'rgba(116,198,157,0.16)' : 'rgba(64,145,108,0.1)',
            color: isDarkMode ? '#95D5B2' : '#40916C',
          }}>
          {logs.length}
        </span>
      </div>

      <div ref={bodyRef} className="max-h-80 space-y-2 overflow-auto pr-1">
        {logs.map(log => (
          <LogItem key={log.id} log={log} isDarkMode={isDarkMode} />
        ))}
      </div>
    </div>
  );
});
