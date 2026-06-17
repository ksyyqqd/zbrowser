/**
 * useWorkflowExecution
 *
 * Subscribes to workflow execution events broadcast from the background
 * service worker via a long-lived port (`options-connection`) and reduces
 * them into an `ExecutionState` snapshot suitable for rendering progress
 * on the WorkflowEditor canvas.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkflowEvent } from '@extension/workflow';
import type { ExecutionState } from '../components/workflow/types';

const INITIAL_STATE: ExecutionState = {
  workflowId: null,
  currentNodeId: null,
  nodeStatus: {},
  status: 'idle',
  events: [],
};

const MAX_EVENTS = 200;

function applyEvent(prev: ExecutionState, ev: WorkflowEvent): ExecutionState {
  const events = [...prev.events, ev];
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);

  switch (ev.type) {
    case 'WORKFLOW_START':
      return {
        workflowId: ev.workflowId,
        currentNodeId: null,
        nodeStatus: {},
        status: 'running',
        events: [ev],
      };
    case 'NODE_START':
      if (!ev.nodeId) return { ...prev, events };
      return {
        ...prev,
        events,
        currentNodeId: ev.nodeId,
        nodeStatus: { ...prev.nodeStatus, [ev.nodeId]: 'running' },
      };
    case 'NODE_OK':
      if (!ev.nodeId) return { ...prev, events };
      return {
        ...prev,
        events,
        nodeStatus: { ...prev.nodeStatus, [ev.nodeId]: 'ok' },
      };
    case 'NODE_FAIL':
      if (!ev.nodeId) return { ...prev, events };
      return {
        ...prev,
        events,
        nodeStatus: { ...prev.nodeStatus, [ev.nodeId]: 'fail' },
      };
    case 'WORKFLOW_OK':
      return { ...prev, events, status: 'completed', currentNodeId: null };
    case 'WORKFLOW_FAIL':
      return { ...prev, events, status: 'failed', currentNodeId: null };
    case 'WORKFLOW_CANCEL':
      return { ...prev, events, status: 'idle', currentNodeId: null };
    default:
      return { ...prev, events };
  }
}

interface UseWorkflowExecutionResult {
  state: ExecutionState;
  reset: () => void;
}

export function useWorkflowExecution(): UseWorkflowExecutionResult {
  const [state, setState] = useState<ExecutionState>(INITIAL_STATE);
  const portRef = useRef<chrome.runtime.Port | null>(null);

  useEffect(() => {
    // Some test/preview environments don't have chrome.runtime
    if (typeof chrome === 'undefined' || !chrome.runtime?.connect) return;

    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect({ name: 'options-connection' });
    } catch (e) {
      // Extension context may not be ready
      return;
    }
    portRef.current = port;

    const onMessage = (msg: { type?: string; event?: WorkflowEvent }) => {
      if (msg?.type !== 'workflow_event' || !msg.event) return;
      setState(s => applyEvent(s, msg.event!));
    };

    const onDisconnect = () => {
      portRef.current = null;
    };

    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);

    return () => {
      try {
        port.disconnect();
      } catch {
        /* already disconnected */
      }
      portRef.current = null;
    };
  }, []);

  const reset = useCallback(() => setState(INITIAL_STATE), []);

  return { state, reset };
}
