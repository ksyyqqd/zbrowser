import { useState, useEffect } from 'react';
import { Button } from '@extension/ui';
import { mcpServersStore, type MCPServerConfig } from '@extension/storage';
import { FiServer, FiPlus, FiTrash2, FiRefreshCw, FiLink, FiX, FiCheck, FiEdit2 } from 'react-icons/fi';
import { t } from '@extension/i18n';

interface MCPSettingsProps {
  isDarkMode?: boolean;
}

interface ServerStatus {
  connected: boolean;
  toolsCount: number;
  lastError?: string;
}

export const MCPSettings = ({ isDarkMode = false }: MCPSettingsProps) => {
  const [servers, setServers] = useState<MCPServerConfig[]>([]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<MCPServerConfig | null>(null);
  const [serverStatuses, setServerStatuses] = useState<Record<string, ServerStatus>>({});
  const [testingConnection, setTestingConnection] = useState<string | null>(null);

  // Form state for add/edit
  const [formData, setFormData] = useState({
    name: '',
    transport: 'websocket' as 'websocket' | 'stdio' | 'sse',
    url: '',
    command: '',
    args: '',
    enabled: true,
    autoConnect: true,
    timeout: 30000,
  });

  useEffect(() => {
    loadServers();
  }, []);

  const loadServers = async () => {
    const serverList = await mcpServersStore.getAllServers();
    setServers(serverList);
  };

  const handleAddServer = async () => {
    if (!formData.name.trim()) {
      return;
    }

    const config: MCPServerConfig = {
      id: `mcp-${Date.now()}`,
      name: formData.name.trim(),
      transport: formData.transport,
      url: formData.transport === 'websocket' || formData.transport === 'sse' ? formData.url.trim() : undefined,
      command: formData.transport === 'stdio' ? formData.command.trim() : undefined,
      args: formData.transport === 'stdio' ? formData.args.split(' ').filter(Boolean) : undefined,
      enabled: formData.enabled,
      autoConnect: formData.autoConnect,
      timeout: formData.timeout,
      retryAttempts: 3,
      createdAt: Date.now(),
    };

    await mcpServersStore.addServer(config);
    await loadServers();
    resetForm();
    setIsAddModalOpen(false);
  };

  const handleUpdateServer = async () => {
    if (!editingServer || !formData.name.trim()) {
      return;
    }

    await mcpServersStore.updateServer(editingServer.id, {
      name: formData.name.trim(),
      transport: formData.transport,
      url: formData.transport === 'websocket' || formData.transport === 'sse' ? formData.url.trim() : undefined,
      command: formData.transport === 'stdio' ? formData.command.trim() : undefined,
      args: formData.transport === 'stdio' ? formData.args.split(' ').filter(Boolean) : undefined,
      enabled: formData.enabled,
      autoConnect: formData.autoConnect,
      timeout: formData.timeout,
    });

    await loadServers();
    resetForm();
    setEditingServer(null);
    setIsAddModalOpen(false);
  };

  const handleDeleteServer = async (id: string) => {
    await mcpServersStore.removeServer(id);
    await loadServers();
  };

  const handleToggleEnabled = async (id: string, enabled: boolean) => {
    await mcpServersStore.setEnabled(id, enabled);
    await loadServers();
  };

  const handleTestConnection = async (server: MCPServerConfig) => {
    setTestingConnection(server.id);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'MCP_TEST_CONNECTION',
        config: server,
      });

      setServerStatuses(prev => ({
        ...prev,
        [server.id]: {
          connected: response?.success ?? false,
          toolsCount: 0,
          lastError: response?.error,
        },
      }));
    } catch {
      setServerStatuses(prev => ({
        ...prev,
        [server.id]: {
          connected: false,
          toolsCount: 0,
          lastError: 'Failed to test connection',
        },
      }));
    }

    setTestingConnection(null);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      transport: 'websocket',
      url: '',
      command: '',
      args: '',
      enabled: true,
      autoConnect: true,
      timeout: 30000,
    });
  };

  const openEditModal = (server: MCPServerConfig) => {
    setEditingServer(server);
    setFormData({
      name: server.name,
      transport: server.transport,
      url: server.url ?? '',
      command: server.command ?? '',
      args: server.args?.join(' ') ?? '',
      enabled: server.enabled,
      autoConnect: server.autoConnect,
      timeout: server.timeout,
    });
    setIsAddModalOpen(true);
  };

  const getStatusBadge = (server: MCPServerConfig) => {
    const status = serverStatuses[server.id];
    if (!status) {
      return (
        <span
          className={`inline-flex items-center rounded-full px-2 py-1 text-xs ${isDarkMode ? 'bg-slate-700 text-gray-400' : 'bg-gray-100 text-gray-500'}`}>
          {t('options_mcp_statusUnknown')}
        </span>
      );
    }

    if (status.connected) {
      return (
        <span
          className={`inline-flex items-center rounded-full px-2 py-1 text-xs ${isDarkMode ? 'bg-green-900 text-green-300' : 'bg-green-100 text-green-700'}`}>
          <FiCheck className="mr-1 h-3 w-3" />
          {t('options_mcp_statusConnected')}
        </span>
      );
    }

    return (
      <span
        className={`inline-flex items-center rounded-full px-2 py-1 text-xs ${isDarkMode ? 'bg-red-900 text-red-300' : 'bg-red-100 text-red-700'}`}>
        <FiX className="mr-1 h-3 w-3" />
        {t('options_mcp_statusDisconnected')}
      </span>
    );
  };

  return (
    <section className="space-y-6">
      {/* Header Section */}
      <div
        className={`rounded-lg border ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-white'} p-6 text-left shadow-sm`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
            {t('options_mcp_header')}
          </h2>
          <Button
            onClick={() => {
              resetForm();
              setEditingServer(null);
              setIsAddModalOpen(true);
            }}
            className={`flex items-center gap-2 ${isDarkMode ? 'bg-sky-600 hover:bg-sky-700' : 'bg-blue-600 hover:bg-blue-700'} text-white`}>
            <FiPlus className="h-4 w-4" />
            {t('options_mcp_addServer')}
          </Button>
        </div>

        <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'} mb-4`}>
          {t('options_mcp_description')}
        </p>

        {/* Server List */}
        {servers.length === 0 ? (
          <div
            className={`rounded-lg border ${isDarkMode ? 'border-slate-600 bg-slate-700/50' : 'border-gray-200 bg-gray-50'} p-8 text-center`}>
            <FiServer className={`mx-auto h-12 w-12 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'} mb-4`} />
            <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>{t('options_mcp_noServers')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {servers.map(server => (
              <div
                key={server.id}
                className={`rounded-lg border ${isDarkMode ? 'border-slate-600 bg-slate-700/50' : 'border-gray-200 bg-gray-50'} p-4`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className={`font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>{server.name}</h3>
                      {getStatusBadge(server)}
                      {!server.enabled && (
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-1 text-xs ${isDarkMode ? 'bg-slate-600 text-gray-400' : 'bg-gray-200 text-gray-500'}`}>
                          {t('options_mcp_statusDisabled')}
                        </span>
                      )}
                    </div>
                    <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                      Transport: {server.transport} |
                      {server.transport === 'websocket' ? ` URL: ${server.url}` : ` Command: ${server.command}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleTestConnection(server)}
                      disabled={testingConnection === server.id}
                      className={`p-2 rounded-md ${isDarkMode ? 'hover:bg-slate-600 text-gray-400 hover:text-gray-200' : 'hover:bg-gray-200 text-gray-500 hover:text-gray-700'} disabled:opacity-50`}
                      title={t('options_mcp_testConnection')}>
                      <FiRefreshCw className={`h-4 w-4 ${testingConnection === server.id ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                      onClick={() => openEditModal(server)}
                      className={`p-2 rounded-md ${isDarkMode ? 'hover:bg-slate-600 text-gray-400 hover:text-gray-200' : 'hover:bg-gray-200 text-gray-500 hover:text-gray-700'}`}
                      title={t('options_mcp_editServer')}>
                      <FiEdit2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleToggleEnabled(server.id, !server.enabled)}
                      className={`p-2 rounded-md ${isDarkMode ? 'hover:bg-slate-600 text-gray-400 hover:text-gray-200' : 'hover:bg-gray-200 text-gray-500 hover:text-gray-700'}`}
                      title={t('options_mcp_toggleServer')}>
                      <FiLink className={`h-4 w-4 ${server.enabled ? '' : 'opacity-50'}`} />
                    </button>
                    <button
                      onClick={() => handleDeleteServer(server.id)}
                      className={`p-2 rounded-md ${isDarkMode ? 'hover:bg-red-900/50 text-gray-400 hover:text-red-300' : 'hover:bg-red-50 text-gray-500 hover:text-red-600'}`}
                      title={t('options_mcp_deleteServer')}>
                      <FiTrash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setIsAddModalOpen(false)} />
          <div
            className={`relative rounded-lg border ${isDarkMode ? 'border-slate-600 bg-slate-800' : 'border-gray-200 bg-white'} p-6 w-full max-w-md mx-4 shadow-xl`}>
            <h3 className={`text-lg font-semibold mb-4 ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
              {editingServer ? t('options_mcp_editModalTitle') : t('options_mcp_addModalTitle')}
            </h3>

            <div className="space-y-4">
              {/* Server Name */}
              <div>
                <label className={`block text-sm font-medium mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {t('options_mcp_serverName')}
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  placeholder="My MCP Server"
                  className={`w-full rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2 text-sm`}
                />
              </div>

              {/* Transport Type */}
              <div>
                <label className={`block text-sm font-medium mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {t('options_mcp_transportType')}
                </label>
                <select
                  value={formData.transport}
                  onChange={e =>
                    setFormData({ ...formData, transport: e.target.value as 'websocket' | 'stdio' | 'sse' })
                  }
                  className={`w-full rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2 text-sm`}>
                  <option value="websocket">WebSocket</option>
                  <option value="sse">SSE (Server-Sent Events)</option>
                  <option value="stdio">Stdio (Native Messaging)</option>
                </select>
              </div>

              {/* WebSocket/SSE URL */}
              {(formData.transport === 'websocket' || formData.transport === 'sse') && (
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    {formData.transport === 'websocket' ? t('options_mcp_websocketUrl') : t('options_mcp_sseUrl')}
                  </label>
                  <input
                    type="url"
                    value={formData.url}
                    onChange={e => setFormData({ ...formData, url: e.target.value })}
                    placeholder={
                      formData.transport === 'websocket' ? 'ws://localhost:3000/mcp' : 'http://localhost:3000/sse'
                    }
                    className={`w-full rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2 text-sm`}
                  />
                  {formData.transport === 'sse' && (
                    <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                      SSE URL usually ends with /sse. The client will connect via EventSource and send requests via HTTP
                      POST.
                    </p>
                  )}
                </div>
              )}

              {/* Stdio Command */}
              {formData.transport === 'stdio' && (
                <>
                  <div>
                    <label
                      className={`block text-sm font-medium mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('options_mcp_command')}
                    </label>
                    <input
                      type="text"
                      value={formData.command}
                      onChange={e => setFormData({ ...formData, command: e.target.value })}
                      placeholder="npx"
                      className={`w-full rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2 text-sm`}
                    />
                  </div>
                  <div>
                    <label
                      className={`block text-sm font-medium mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('options_mcp_args')}
                    </label>
                    <input
                      type="text"
                      value={formData.args}
                      onChange={e => setFormData({ ...formData, args: e.target.value })}
                      placeholder="-y @anthropic/mcp-server-filesystem"
                      className={`w-full rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2 text-sm`}
                    />
                  </div>
                </>
              )}

              {/* Options */}
              <div className="flex items-center gap-4">
                <label className={`flex items-center gap-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <input
                    type="checkbox"
                    checked={formData.enabled}
                    onChange={e => setFormData({ ...formData, enabled: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-sm">{t('options_mcp_enabled')}</span>
                </label>
                <label className={`flex items-center gap-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <input
                    type="checkbox"
                    checked={formData.autoConnect}
                    onChange={e => setFormData({ ...formData, autoConnect: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-sm">{t('options_mcp_autoConnect')}</span>
                </label>
              </div>

              {/* Timeout */}
              <div>
                <label className={`block text-sm font-medium mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {t('options_mcp_timeout')}
                </label>
                <input
                  type="number"
                  value={formData.timeout}
                  onChange={e => setFormData({ ...formData, timeout: parseInt(e.target.value) || 30000 })}
                  min={5000}
                  max={120000}
                  className={`w-full rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2 text-sm`}
                />
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex justify-end gap-2 mt-6">
              <Button
                onClick={() => {
                  setIsAddModalOpen(false);
                  setEditingServer(null);
                  resetForm();
                }}
                className={`${isDarkMode ? 'bg-slate-600 hover:bg-slate-500 text-gray-200' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}>
                {t('options_mcp_cancel')}
              </Button>
              <Button
                onClick={editingServer ? handleUpdateServer : handleAddServer}
                disabled={!formData.name.trim()}
                className={`${isDarkMode ? 'bg-sky-600 hover:bg-sky-700' : 'bg-blue-600 hover:bg-blue-700'} text-white disabled:opacity-50`}>
                {editingServer ? t('options_mcp_update') : t('options_mcp_add')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
