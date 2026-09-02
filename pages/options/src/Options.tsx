import { useEffect, useState } from 'react';
import '@src/Options.css';
import { Button } from '@extension/ui';
import { withErrorBoundary, withSuspense, MCP_ENABLED } from '@extension/shared';
import { t } from '@extension/i18n';
import { FiCode, FiCpu, FiServer, FiSettings, FiShare2 } from 'react-icons/fi';
import { LuBrain } from 'react-icons/lu';
import { AnalyticsSettings } from './components/AnalyticsSettings';
import { ElementMemorySettings } from './components/ElementMemorySettings';
import { FirewallSettings } from './components/FirewallSettings';
import { GeneralSettings } from './components/GeneralSettings';
import { MCPSettings } from './components/MCPSettings';
import { ModelSettings } from './components/ModelSettings';
import { SkillSettings } from './components/SkillSettings';
import WorkflowSettings from './components/WorkflowSettings';

type TabTypes = 'general' | 'models' | 'mcp' | 'skills' | 'workflows' | 'firewall' | 'analytics' | 'help' | 'memory';

const TABS: { id: TabTypes; icon: React.ComponentType<{ className?: string }>; label: string }[] = [
  { id: 'general', icon: FiSettings, label: t('options_tabs_general') },
  { id: 'models', icon: FiCpu, label: t('options_tabs_models') },
  { id: 'skills', icon: FiCode, label: t('options_tabs_skills') },
  { id: 'workflows', icon: FiShare2, label: t('options_tabs_workflows') },
  { id: 'memory', icon: LuBrain, label: t('options_tabs_memory') },
  // MCP 屏蔽期间不展示入口：配置了也连不上，摆着只会误导
  ...(MCP_ENABLED ? [{ id: 'mcp' as TabTypes, icon: FiServer, label: t('options_tabs_mcp') }] : []),
];

const TAB_SECTIONS: { label: string; tabIds: TabTypes[] }[] = [
  { label: t('options_sections_common'), tabIds: ['general', 'models'] },
  { label: t('options_sections_automation'), tabIds: ['skills', 'workflows', 'memory'] },
  // 高级分组当前只有 MCP 一项，MCP 屏蔽时整个分组不渲染
  ...(MCP_ENABLED ? [{ label: t('options_sections_advanced'), tabIds: ['mcp' as TabTypes] }] : []),
];

const Options = () => {
  const getInitialTab = (): TabTypes => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    const validTabs: TabTypes[] = [
      'general',
      'models',
      // MCP 屏蔽时不接受 ?tab=mcp 深链，否则能绕过隐藏的侧栏入口直接打开设置面板
      ...(MCP_ENABLED ? (['mcp'] as TabTypes[]) : []),
      'skills',
      'workflows',
      'memory',
      'firewall',
      'analytics',
      'help',
    ];
    if (tabParam && validTabs.includes(tabParam as TabTypes)) {
      return tabParam as TabTypes;
    }
    return 'models';
  };

  const [activeTab, setActiveTab] = useState<TabTypes>(getInitialTab);
  const readStoredDarkMode = (): boolean => {
    try {
      const saved = localStorage.getItem('nanobrowser_dark_mode');
      if (saved === 'true') return true;
      if (saved === 'false') return false;
    } catch {
      /* ignore */
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  };
  const [isDarkMode, setIsDarkMode] = useState<boolean>(readStoredDarkMode);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== 'nanobrowser_dark_mode') return;
      if (e.newValue === 'true') setIsDarkMode(true);
      else if (e.newValue === 'false') setIsDarkMode(false);
      else setIsDarkMode(window.matchMedia('(prefers-color-scheme: dark)').matches);
    };
    window.addEventListener('storage', handleStorage);

    const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleOsChange = (e: MediaQueryListEvent) => {
      try {
        if (localStorage.getItem('nanobrowser_dark_mode') == null) {
          setIsDarkMode(e.matches);
        }
      } catch {
        setIsDarkMode(e.matches);
      }
    };
    darkModeMediaQuery.addEventListener('change', handleOsChange);

    return () => {
      window.removeEventListener('storage', handleStorage);
      darkModeMediaQuery.removeEventListener('change', handleOsChange);
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);

    return () => {
      document.documentElement.classList.remove('dark');
    };
  }, [isDarkMode]);

  const handleTabClick = (tabId: TabTypes) => {
    if (tabId === 'help') {
      window.open('https://nanobrowser.ai/docs', '_blank');
    } else {
      setActiveTab(tabId);
    }
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'general':
        return <GeneralSettings isDarkMode={isDarkMode} />;
      case 'models':
        return <ModelSettings isDarkMode={isDarkMode} />;
      case 'mcp':
        return MCP_ENABLED ? <MCPSettings isDarkMode={isDarkMode} /> : null;
      case 'skills':
        return <SkillSettings isDarkMode={isDarkMode} />;
      case 'workflows':
        return <WorkflowSettings isDarkMode={isDarkMode} />;
      case 'memory':
        return <ElementMemorySettings isDarkMode={isDarkMode} />;
      case 'firewall':
        return <FirewallSettings isDarkMode={isDarkMode} />;
      case 'analytics':
        return <AnalyticsSettings isDarkMode={isDarkMode} />;
      default:
        return null;
    }
  };

  return (
    <div className={isDarkMode ? 'dark' : ''}>
      <div
        className={`flex min-h-screen min-w-[768px] ${isDarkMode ? 'bg-slate-900' : "bg-[url('/bg.jpg')] bg-cover bg-center"} ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
        <nav
          className={`w-48 border-r ${isDarkMode ? 'border-slate-700 bg-slate-800/80' : 'border-white/20 bg-[#0EA5E9]/10'} backdrop-blur-sm`}>
          <div className="p-4">
            <h1 className={`mb-6 text-xl font-bold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
              {t('options_nav_header')}
            </h1>
            <ul className="space-y-2">
              {TAB_SECTIONS.map(section => {
                const sectionTabs = TABS.filter(t => section.tabIds.includes(t.id));
                return (
                  <li key={section.label}>
                    <div
                      className="mb-1 mt-3 px-2 text-[11px] font-semibold uppercase tracking-wider"
                      style={{
                        color: isDarkMode ? 'rgba(116,198,157,0.6)' : 'rgba(64,145,108,0.7)',
                        opacity: 0.8,
                      }}>
                      {section.label}
                    </div>
                    <ul className="space-y-1">
                      {sectionTabs.map(item => (
                        <li key={item.id}>
                          <Button
                            onClick={() => handleTabClick(item.id)}
                            className={`flex w-full items-center space-x-2 rounded-lg px-4 py-2 text-left text-base ${
                              activeTab !== item.id
                                ? `${isDarkMode ? 'bg-slate-700/70 text-gray-300 hover:text-white' : 'bg-[#0EA5E9]/15 font-medium text-gray-700 hover:text-white'} backdrop-blur-sm`
                                : `${isDarkMode ? 'bg-sky-800/50' : ''} text-white backdrop-blur-sm`
                            }`}>
                            <item.icon className="size-4" />
                            <span>{item.label}</span>
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </div>
        </nav>

        <main className={`min-w-0 flex-1 ${isDarkMode ? 'bg-slate-800/50' : 'bg-white/10'} p-8`}>
          <div className="mx-auto min-w-0 max-w-screen-lg">{renderTabContent()}</div>
        </main>
      </div>
    </div>
  );
};

export default withErrorBoundary(withSuspense(Options, <div>Loading...</div>), <div>Error Occurred</div>);
