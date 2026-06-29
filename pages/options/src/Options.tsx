import { useState, useEffect } from 'react';
import '@src/Options.css';
import { Button } from '@extension/ui';
import { withErrorBoundary, withSuspense } from '@extension/shared';
import { t } from '@extension/i18n';
import {
  FiSettings,
  FiCpu,
  FiShield,
  FiTrendingUp,
  FiHelpCircle,
  FiServer,
  FiCode,
  FiShare2,
  FiImage,
} from 'react-icons/fi';
import { GiWheat } from 'react-icons/gi';
import { LuBrain } from 'react-icons/lu';
import { GeneralSettings } from './components/GeneralSettings';
import { ModelSettings } from './components/ModelSettings';
import { FirewallSettings } from './components/FirewallSettings';
import { AnalyticsSettings } from './components/AnalyticsSettings';
import { MCPSettings } from './components/MCPSettings';
import { SkillSettings } from './components/SkillSettings';
import WorkflowSettings from './components/WorkflowSettings';
import { ImageProvidersSection } from './components/ImageProvidersSection';
import { FarmerSitesSettings } from './components/FarmerSitesSettings';
import { ElementMemorySettings } from './components/ElementMemorySettings';

type TabTypes =
  | 'general'
  | 'models'
  | 'mcp'
  | 'skills'
  | 'workflows'
  | 'firewall'
  | 'analytics'
  | 'help'
  | 'images'
  | 'farmer'
  | 'memory';

const TABS: { id: TabTypes; icon: React.ComponentType<{ className?: string }>; label: string }[] = [
  { id: 'general', icon: FiSettings, label: t('options_tabs_general') },
  { id: 'models', icon: FiCpu, label: t('options_tabs_models') },
  { id: 'images', icon: FiImage, label: t('options_tabs_images') },
  { id: 'mcp', icon: FiServer, label: t('options_tabs_mcp') },
  { id: 'skills', icon: FiCode, label: t('options_tabs_skills') },
  { id: 'workflows', icon: FiShare2, label: t('options_tabs_workflows') },
  { id: 'farmer', icon: GiWheat, label: '农场主' },
  { id: 'memory', icon: LuBrain, label: '元素记忆' },
  // { id: 'firewall', icon: FiShield, label: t('options_tabs_firewall') },
  // { id: 'analytics', icon: FiTrendingUp, label: 'Analytics' },
  // { id: 'help', icon: FiHelpCircle, label: t('options_tabs_help') },
];

const Options = () => {
  // Read initial tab from URL query parameter (e.g., ?tab=workflows)
  const getInitialTab = (): TabTypes => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    const validTabs: TabTypes[] = [
      'general',
      'models',
      'images',
      'mcp',
      'skills',
      'workflows',
      'farmer',
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
  // Theme is shared with the side-panel via localStorage['nanobrowser_dark_mode'].
  // If the user hasn't picked one yet, fall back to the OS preference.
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

  // Keep theme in sync with the side-panel (cross-page via the storage event)
  // and with OS preference changes when no manual choice has been made.
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
      // Only follow OS preference when the user hasn't made an explicit choice.
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
      case 'images':
        return <ImageProvidersSection isDarkMode={isDarkMode} />;
      case 'mcp':
        return <MCPSettings isDarkMode={isDarkMode} />;
      case 'skills':
        return <SkillSettings isDarkMode={isDarkMode} />;
      case 'workflows':
        return <WorkflowSettings isDarkMode={isDarkMode} />;
      case 'farmer':
        return <FarmerSitesSettings isDarkMode={isDarkMode} />;
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
    <div
      className={`flex min-h-screen min-w-[768px] ${isDarkMode ? 'bg-slate-900' : "bg-[url('/bg.jpg')] bg-cover bg-center"} ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
      {/* Vertical Navigation Bar */}
      <nav
        className={`w-48 border-r ${isDarkMode ? 'border-slate-700 bg-slate-800/80' : 'border-white/20 bg-[#0EA5E9]/10'} backdrop-blur-sm`}>
        <div className="p-4">
          <h1 className={`mb-6 text-xl font-bold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
            {t('options_nav_header')}
          </h1>
          <ul className="space-y-2">
            {TABS.map(item => (
              <li key={item.id}>
                <Button
                  onClick={() => handleTabClick(item.id)}
                  className={`flex w-full items-center space-x-2 rounded-lg px-4 py-2 text-left text-base 
                    ${
                      activeTab !== item.id
                        ? `${isDarkMode ? 'bg-slate-700/70 text-gray-300 hover:text-white' : 'bg-[#0EA5E9]/15 font-medium text-gray-700 hover:text-white'} backdrop-blur-sm`
                        : `${isDarkMode ? 'bg-sky-800/50' : ''} text-white backdrop-blur-sm`
                    }`}>
                  <item.icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className={`min-w-0 flex-1 ${isDarkMode ? 'bg-slate-800/50' : 'bg-white/10'} p-8`}>
        <div className="mx-auto min-w-0 max-w-screen-lg">{renderTabContent()}</div>
      </main>
    </div>
  );
};

export default withErrorBoundary(withSuspense(Options, <div>Loading...</div>), <div>Error Occurred</div>);
