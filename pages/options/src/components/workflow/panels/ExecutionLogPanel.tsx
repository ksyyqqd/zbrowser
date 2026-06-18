/**
 * ExecutionLogPanel
 *
 * Right-side panel that streams workflow execution events in real time.
 * Lists each event with its type, target node, timestamp and details (which
 * for NODE_OK contains the node's output snippet).
 */
import { useEffect, useRef, useState } from 'react';
import { FiCheckCircle, FiAlertCircle, FiPlay, FiSquare, FiZap, FiCpu, FiCopy, FiCheck } from 'react-icons/fi';
import type { WorkflowEvent, WorkflowEventType } from '@extension/workflow';

interface AiOutput {
  nodeId: string;
  name: string;
  output: string;
}

interface ExecutionLogPanelProps {
  events: WorkflowEvent[];
  status: 'idle' | 'running' | 'completed' | 'failed';
  isDarkMode: boolean;
  outputs?: AiOutput[];
}

function formatTime(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function eventColorClass(type: WorkflowEventType, isDark: boolean): string {
  switch (type) {
    case 'WORKFLOW_START':
    case 'NODE_START':
      return isDark ? 'text-blue-300' : 'text-blue-600';
    case 'WORKFLOW_OK':
    case 'NODE_OK':
      return isDark ? 'text-green-300' : 'text-green-600';
    case 'WORKFLOW_FAIL':
    case 'NODE_FAIL':
      return isDark ? 'text-red-300' : 'text-red-600';
    case 'BRANCH_SELECT':
      return isDark ? 'text-orange-300' : 'text-orange-600';
    default:
      return isDark ? 'text-gray-400' : 'text-gray-500';
  }
}

function EventIcon({ type }: { type: WorkflowEventType }) {
  switch (type) {
    case 'WORKFLOW_START':
      return <FiPlay className="size-3" />;
    case 'WORKFLOW_OK':
    case 'NODE_OK':
      return <FiCheckCircle className="size-3" />;
    case 'WORKFLOW_FAIL':
    case 'NODE_FAIL':
      return <FiAlertCircle className="size-3" />;
    case 'WORKFLOW_CANCEL':
      return <FiSquare className="size-3" />;
    case 'BRANCH_SELECT':
      return <FiZap className="size-3" />;
    default:
      return <span className="size-3" />;
  }
}

export function ExecutionLogPanel({ events, status, isDarkMode, outputs = [] }: ExecutionLogPanelProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Auto-scroll to bottom on new events
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  const copyOutput = (id: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(prev => (prev === id ? null : prev)), 1500);
    });
  };

  const showSummary = (status === 'completed' || status === 'failed') && outputs.length > 0;

  const statusBadge = (() => {
    switch (status) {
      case 'running':
        return { label: '运行中', cls: 'bg-blue-500 text-white animate-pulse' };
      case 'completed':
        return { label: '已完成', cls: 'bg-green-500 text-white' };
      case 'failed':
        return { label: '已失败', cls: 'bg-red-500 text-white' };
      default:
        return { label: '空闲', cls: isDarkMode ? 'bg-slate-600 text-gray-300' : 'bg-gray-200 text-gray-600' };
    }
  })();

  return (
    <div className="flex h-full flex-col">
      <div
        className={`flex items-center justify-between border-b px-4 py-2 ${
          isDarkMode ? 'border-slate-700' : 'border-gray-200'
        }`}>
        <span className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          {events.length} 条事件
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusBadge.cls}`}>
          {statusBadge.label}
        </span>
      </div>

      <div ref={scrollRef} className="rp-log-scroll flex-1 overflow-y-auto p-2">
        {showSummary && (
          <div
            className={`mb-2 rounded-md border p-2.5 ${
              status === 'completed'
                ? isDarkMode
                  ? 'border-green-700/40 bg-green-900/20'
                  : 'border-green-200 bg-green-50'
                : isDarkMode
                  ? 'border-red-700/40 bg-red-900/20'
                  : 'border-red-200 bg-red-50'
            }`}>
            <div
              className={`mb-2 flex items-center gap-1.5 text-xs font-semibold ${
                status === 'completed'
                  ? isDarkMode
                    ? 'text-green-300'
                    : 'text-green-700'
                  : isDarkMode
                    ? 'text-red-300'
                    : 'text-red-700'
              }`}>
              <FiCpu className="size-3.5" />
              输出结果（{outputs.length}）
            </div>
            <div className="space-y-2">
              {outputs.map(out => (
                <div
                  key={out.nodeId}
                  className={`rounded-md border ${
                    isDarkMode ? 'border-slate-700 bg-slate-800/60' : 'border-gray-200 bg-white'
                  }`}>
                  <div
                    className={`flex items-center justify-between gap-2 border-b px-2 py-1 ${
                      isDarkMode ? 'border-slate-700' : 'border-gray-200'
                    }`}>
                    <span className={`truncate text-xs font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                      {out.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => copyOutput(out.nodeId, out.output)}
                      className={`shrink-0 rounded p-1 transition-colors ${
                        isDarkMode ? 'text-gray-400 hover:bg-slate-700' : 'text-gray-500 hover:bg-gray-100'
                      }`}
                      title="复制">
                      {copiedId === out.nodeId ? (
                        <FiCheck className="size-3 text-green-500" />
                      ) : (
                        <FiCopy className="size-3" />
                      )}
                    </button>
                  </div>
                  <div
                    className={`rp-log-scroll max-h-48 overflow-y-auto whitespace-pre-wrap break-words p-2 text-[11px] leading-relaxed ${
                      isDarkMode ? 'text-gray-300' : 'text-gray-600'
                    }`}>
                    {out.output}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {events.length === 0 ? (
          <div
            className={`mt-8 rounded-md border border-dashed px-3 py-6 text-center text-xs ${
              isDarkMode ? 'border-slate-600 text-gray-500' : 'border-gray-300 text-gray-400'
            }`}>
            尚未运行。点击 ▶ 执行工作流后，事件将实时显示在此处。
          </div>
        ) : (
          <ul className="space-y-1">
            {events.map((ev, idx) => (
              <li
                key={idx}
                className={`rounded-md border px-2 py-1.5 text-xs ${
                  isDarkMode ? 'border-slate-700 bg-slate-800/60' : 'border-gray-200 bg-gray-50'
                }`}>
                <div className="flex items-center gap-1.5">
                  <span className={eventColorClass(ev.type, isDarkMode)}>
                    <EventIcon type={ev.type} />
                  </span>
                  <span className={`font-mono font-semibold ${eventColorClass(ev.type, isDarkMode)}`}>{ev.type}</span>
                  {ev.nodeName && (
                    <span className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>· {ev.nodeName}</span>
                  )}
                  <span className={`ml-auto font-mono text-[10px] ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    {formatTime(ev.timestamp)}
                  </span>
                </div>
                {ev.details && (
                  <div
                    className={`mt-1 whitespace-pre-wrap break-all rounded px-2 py-1 font-mono text-[11px] leading-snug ${
                      isDarkMode ? 'bg-slate-900/60 text-gray-300' : 'bg-white text-gray-600'
                    }`}>
                    {ev.details}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
