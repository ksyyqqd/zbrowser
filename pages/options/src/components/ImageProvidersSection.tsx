import { useEffect, useState, useRef, useCallback } from 'react';
import { Button } from '@extension/ui';
import {
  imageProviderStore,
  ImageProviderTypeEnum,
  imageProviderModelNames,
  imageProviderSizes,
  imageProviderQualities,
  getDefaultImageProviderConfig,
  getDefaultDisplayNameFromImageProviderId,
  type ImageProviderConfig,
} from '@extension/storage';
import { t } from '@extension/i18n';
import { FiImage, FiEye, FiEyeOff, FiPlus, FiTrash2, FiCheck, FiX, FiRefreshCw } from 'react-icons/fi';

interface ImageProvidersSectionProps {
  isDarkMode?: boolean;
}

export const ImageProvidersSection = ({ isDarkMode = false }: ImageProvidersSectionProps) => {
  const [providers, setProviders] = useState<Record<string, ImageProviderConfig>>({});
  const [modifiedProviders, setModifiedProviders] = useState<Set<string>>(new Set());
  const [providersFromStorage, setProvidersFromStorage] = useState<Set<string>>(new Set());
  const [activeProvider, setActiveProvider] = useState<string | undefined>();
  const [visibleApiKeys, setVisibleApiKeys] = useState<Record<string, boolean>>({});
  const [newModelInputs, setNewModelInputs] = useState<Record<string, string>>({});
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { success: boolean; error?: string }>>({});
  const newlyAddedProviderRef = useRef<string | null>(null);

  // Load providers from storage on mount
  useEffect(() => {
    const loadProviders = async () => {
      try {
        const storedProviders = await imageProviderStore.getAllProviders();
        const storedActiveProvider = await imageProviderStore.getActiveProvider();

        setProviders(storedProviders);
        setActiveProvider(storedActiveProvider);

        const storedKeys = new Set(Object.keys(storedProviders));
        setProvidersFromStorage(storedKeys);

        // Initialize model inputs for each provider
        const initialInputs: Record<string, string> = {};
        Object.keys(storedProviders).forEach(provider => {
          initialInputs[provider] = '';
        });
        setNewModelInputs(initialInputs);
      } catch (error) {
        console.error('Error loading image providers:', error);
      }
    };

    loadProviders();
  }, []);

  // Handle API key visibility toggle
  const toggleApiKeyVisibility = (provider: string) => {
    setVisibleApiKeys(prev => ({
      ...prev,
      [provider]: !prev[provider],
    }));
  };

  // Handle name change
  const handleNameChange = (provider: string, name: string) => {
    setModifiedProviders(prev => new Set(prev).add(provider));
    setProviders(prev => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        name: name.trim(),
      },
    }));
  };

  // Handle API key change
  const handleApiKeyChange = (provider: string, apiKey: string) => {
    setModifiedProviders(prev => new Set(prev).add(provider));
    setProviders(prev => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        apiKey,
      },
    }));
  };

  // Handle base URL change
  const handleBaseUrlChange = (provider: string, baseUrl: string) => {
    setModifiedProviders(prev => new Set(prev).add(provider));
    setProviders(prev => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        baseUrl,
      },
    }));
  };

  // Handle default model change
  const handleDefaultModelChange = (provider: string, model: string) => {
    setModifiedProviders(prev => new Set(prev).add(provider));
    setProviders(prev => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        defaultModel: model,
      },
    }));
  };

  // Handle default size change
  const handleDefaultSizeChange = (provider: string, size: string) => {
    setModifiedProviders(prev => new Set(prev).add(provider));
    setProviders(prev => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        defaultSize: size,
      },
    }));
  };

  // Add a new model to provider
  const addModel = (provider: string, model: string) => {
    if (!model.trim()) return;

    setModifiedProviders(prev => new Set(prev).add(provider));
    setProviders(prev => {
      const providerData = prev[provider] || {};
      let currentModels = providerData.modelNames || [];

      // Don't add duplicates
      if (currentModels.includes(model.trim())) return prev;

      return {
        ...prev,
        [provider]: {
          ...providerData,
          modelNames: [...currentModels, model.trim()],
        },
      };
    });

    // Clear the input
    setNewModelInputs(prev => ({
      ...prev,
      [provider]: '',
    }));
  };

  // Remove a model from provider
  const removeModel = (provider: string, modelToRemove: string) => {
    setModifiedProviders(prev => new Set(prev).add(provider));

    setProviders(prev => {
      const providerData = prev[provider] || {};
      const currentModels = providerData.modelNames || [];

      return {
        ...prev,
        [provider]: {
          ...providerData,
          modelNames: currentModels.filter(model => model !== modelToRemove),
        },
      };
    });
  };

  // Save provider to storage
  const handleSave = async (provider: string) => {
    try {
      const providerConfig = providers[provider];
      if (!providerConfig) return;

      await imageProviderStore.setProvider(provider, providerConfig);

      // Update storage tracking
      setProvidersFromStorage(prev => new Set(prev).add(provider));
      setModifiedProviders(prev => {
        const next = new Set(prev);
        next.delete(provider);
        return next;
      });

      // Clear test result
      setTestResult(prev => {
        const next = { ...prev };
        delete next[provider];
        return next;
      });
    } catch (error) {
      console.error('Error saving image provider:', error);
    }
  };

  // Delete provider from storage
  const handleDelete = async (provider: string) => {
    try {
      await imageProviderStore.removeProvider(provider);

      // Update all states
      setProvidersFromStorage(prev => {
        const next = new Set(prev);
        next.delete(provider);
        return next;
      });

      setProviders(prev => {
        const next = { ...prev };
        delete next[provider];
        return next;
      });

      setModifiedProviders(prev => {
        const next = new Set(prev);
        next.delete(provider);
        return next;
      });

      // Update active provider if it was deleted
      if (activeProvider === provider) {
        const remainingProviders = Object.keys(providers).filter(p => p !== provider);
        setActiveProvider(remainingProviders.length > 0 ? remainingProviders[0] : undefined);
      }
    } catch (error) {
      console.error('Error deleting image provider:', error);
    }
  };

  // Cancel adding new provider
  const handleCancelProvider = (providerId: string) => {
    setProviders(prev => {
      const next = { ...prev };
      delete next[providerId];
      return next;
    });

    setModifiedProviders(prev => {
      const next = new Set(prev);
      next.delete(providerId);
      return next;
    });
  };

  // Set active provider
  const handleSetActive = async (provider: string) => {
    try {
      await imageProviderStore.setActiveProvider(provider);
      setActiveProvider(provider);
    } catch (error) {
      console.error('Error setting active provider:', error);
    }
  };

  // Test provider connection
  const handleTestConnection = async (provider: string) => {
    setTestingProvider(provider);
    setTestResult(prev => {
      const next = { ...prev };
      delete next[provider];
      return next;
    });

    try {
      // First save the provider if it's modified
      const providerConfig = providers[provider];
      if (providerConfig && modifiedProviders.has(provider)) {
        await imageProviderStore.setProvider(provider, providerConfig);
      }

      // Use sendMessage for one-off request (options page doesn't maintain long-lived port)
      const response = await chrome.runtime.sendMessage({
        type: 'test_image_provider',
        providerId: provider,
      });

      if (response && response.type === 'test_image_provider_result') {
        setTestResult(prev => ({
          ...prev,
          [provider]: {
            success: response.success,
            error: response.error,
          },
        }));
      } else if (response && response.type === 'error') {
        setTestResult(prev => ({
          ...prev,
          [provider]: {
            success: false,
            error: response.error,
          },
        }));
      } else {
        setTestResult(prev => ({
          ...prev,
          [provider]: {
            success: false,
            error: 'Unexpected response',
          },
        }));
      }
    } catch (error) {
      setTestResult(prev => ({
        ...prev,
        [provider]: {
          success: false,
          error: error instanceof Error ? error.message : 'Test failed',
        },
      }));
    } finally {
      setTestingProvider(null);
    }
  };

  // Add new provider
  const addProvider = (providerType: string) => {
    const config = getDefaultImageProviderConfig(providerType);

    setProviders(prev => ({
      ...prev,
      [providerType]: config,
    }));

    setModifiedProviders(prev => new Set(prev).add(providerType));
    setNewModelInputs(prev => ({
      ...prev,
      [providerType]: '',
    }));
    newlyAddedProviderRef.current = providerType;

    setTimeout(() => {
      const providerElement = document.getElementById(`image-provider-${providerType}`);
      if (providerElement) {
        providerElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  };

  // Add custom provider
  const addCustomProvider = () => {
    // Count existing custom providers
    const customProviders = Object.keys(providers).filter(
      key => key.startsWith('custom_image_') || key === 'custom_image',
    );
    const nextNumber = customProviders.length + 1;
    const providerId = nextNumber === 1 ? 'custom_image' : `custom_image_${nextNumber}`;

    const config = getDefaultImageProviderConfig(ImageProviderTypeEnum.CustomOpenAI);
    config.name = `Custom Image ${nextNumber}`;

    setProviders(prev => ({
      ...prev,
      [providerId]: config,
    }));

    setModifiedProviders(prev => new Set(prev).add(providerId));
    setNewModelInputs(prev => ({
      ...prev,
      [providerId]: '',
    }));
    newlyAddedProviderRef.current = providerId;

    setTimeout(() => {
      const providerElement = document.getElementById(`image-provider-${providerId}`);
      if (providerElement) {
        providerElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  };

  // Sort providers
  const getSortedProviders = () => {
    return Object.entries(providers)
      .filter(([providerId, config]) => {
        if (!config) return false;
        return providersFromStorage.has(providerId) || modifiedProviders.has(providerId);
      })
      .sort(([keyA, configA], [keyB, configB]) => {
        const isNewA = !providersFromStorage.has(keyA) && modifiedProviders.has(keyA);
        const isNewB = !providersFromStorage.has(keyB) && modifiedProviders.has(keyB);

        if (isNewA && !isNewB) return 1;
        if (!isNewA && isNewB) return -1;

        return (configA.createdAt || 0) - (configB.createdAt || 0);
      });
  };

  const sortedProviders = getSortedProviders();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
            {t('image_generation_providers')}
          </h2>
          <p className={`mt-1 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            {t('image_generation_title')}
          </p>
        </div>

        {/* Add Provider Dropdown */}
        <div className="flex gap-2">
          <Button
            onClick={() => addProvider(ImageProviderTypeEnum.OpenAI)}
            className={`flex items-center gap-2 px-3 py-2 ${isDarkMode ? 'bg-sky-800 hover:bg-sky-700' : 'bg-sky-500 hover:bg-sky-600'} text-white rounded-lg`}
            variant="primary">
            <FiPlus className="h-4 w-4" />
            {t('image_generation_openaiProvider')}
          </Button>
          <Button
            onClick={addCustomProvider}
            className={`flex items-center gap-2 px-3 py-2 ${isDarkMode ? 'bg-slate-600 hover:bg-slate-500' : 'bg-gray-200 hover:bg-gray-300'} ${isDarkMode ? 'text-gray-200' : 'text-gray-700'} rounded-lg`}
            variant="secondary">
            <FiPlus className="h-4 w-4" />
            {t('image_generation_customProvider')}
          </Button>
        </div>
      </div>

      {/* Provider Cards */}
      {sortedProviders.length === 0 ? (
        <div
          className={`rounded-lg border ${isDarkMode ? 'border-slate-600 bg-slate-700/50' : 'border-gray-200 bg-gray-50'} p-8 text-center`}>
          <FiImage className={`mx-auto h-12 w-12 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`} />
          <p className={`mt-4 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            {t('image_generation_noProvider')}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedProviders.map(([providerId, config]) => {
            const isInStorage = providersFromStorage.has(providerId);
            const isModified = modifiedProviders.has(providerId);
            const isActive = activeProvider === providerId;
            const isTesting = testingProvider === providerId;
            const providerTestResult = testResult[providerId];
            const availableSizes = imageProviderSizes[config.type as keyof typeof imageProviderSizes] || ['1024x1024'];

            return (
              <div
                key={providerId}
                id={`image-provider-${providerId}`}
                className={`rounded-lg border ${isDarkMode ? 'border-slate-600 bg-slate-700/50' : 'border-gray-200 bg-white/80'} p-4 backdrop-blur-sm ${isActive ? `ring-2 ${isDarkMode ? 'ring-sky-500' : 'ring-sky-400'}` : ''}`}>
                {/* Provider Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <FiImage className={`h-5 w-5 ${isDarkMode ? 'text-sky-400' : 'text-sky-500'}`} />
                    <input
                      type="text"
                      value={config.name || ''}
                      onChange={e => handleNameChange(providerId, e.target.value)}
                      placeholder={t('image_generation_providerName')}
                      className={`w-48 rounded-md border ${isDarkMode ? 'border-slate-500 bg-slate-600 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-1.5 text-sm`}
                    />
                    {isActive && (
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs ${isDarkMode ? 'bg-sky-900/50 text-sky-300' : 'bg-sky-100 text-sky-700'}`}>
                        <FiCheck className="h-3 w-3" />
                        {t('image_generation_activeProvider')}
                      </span>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-2">
                    {!isActive && isInStorage && (
                      <Button
                        onClick={() => handleSetActive(providerId)}
                        className={`px-3 py-1.5 text-sm ${isDarkMode ? 'bg-sky-800 hover:bg-sky-700' : 'bg-sky-100 hover:bg-sky-200'} ${isDarkMode ? 'text-sky-300' : 'text-sky-700'} rounded-lg`}
                        variant="secondary">
                        {t('image_generation_setActive')}
                      </Button>
                    )}

                    <Button
                      onClick={() => handleTestConnection(providerId)}
                      disabled={isTesting || !config.apiKey}
                      className={`flex items-center gap-1 px-3 py-1.5 text-sm ${isDarkMode ? 'bg-slate-600 hover:bg-slate-500' : 'bg-gray-100 hover:bg-gray-200'} ${isDarkMode ? 'text-gray-300' : 'text-gray-600'} rounded-lg disabled:opacity-50`}
                      variant="secondary">
                      {isTesting ? (
                        <FiRefreshCw className="h-3 w-3 animate-spin" />
                      ) : (
                        <FiRefreshCw className="h-3 w-3" />
                      )}
                      {t('image_generation_testConnection')}
                    </Button>

                    {providerTestResult && (
                      <span
                        className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${providerTestResult.success ? (isDarkMode ? 'bg-green-900/50 text-green-300' : 'bg-green-100 text-green-700') : isDarkMode ? 'bg-red-900/50 text-red-300' : 'bg-red-100 text-red-700'}`}>
                        {providerTestResult.success ? <FiCheck className="h-3 w-3" /> : <FiX className="h-3 w-3" />}
                        {providerTestResult.success
                          ? t('image_generation_testSuccess')
                          : providerTestResult.error || t('image_generation_testFailed')}
                      </span>
                    )}

                    {/* Save/Delete buttons */}
                    {isInStorage && !isModified ? (
                      <Button
                        onClick={() => handleDelete(providerId)}
                        className={`flex items-center gap-1 px-3 py-1.5 text-sm ${isDarkMode ? 'bg-red-900/50 hover:bg-red-800/50 text-red-300' : 'bg-red-100 hover:bg-red-200 text-red-700'} rounded-lg`}
                        variant="secondary">
                        <FiTrash2 className="h-3 w-3" />
                        {t('image_generation_removeProvider')}
                      </Button>
                    ) : (
                      <>
                        <Button
                          onClick={() => handleSave(providerId)}
                          disabled={!config.apiKey}
                          className={`flex items-center gap-1 px-3 py-1.5 text-sm ${isDarkMode ? 'bg-sky-800 hover:bg-sky-700' : 'bg-sky-500 hover:bg-sky-600'} text-white rounded-lg disabled:opacity-50`}
                          variant="primary">
                          <FiCheck className="h-3 w-3" />
                          {t('image_generation_saveProvider')}
                        </Button>
                        <Button
                          onClick={() => handleCancelProvider(providerId)}
                          className={`flex items-center gap-1 px-3 py-1.5 text-sm ${isDarkMode ? 'bg-slate-600 hover:bg-slate-500' : 'bg-gray-100 hover:bg-gray-200'} ${isDarkMode ? 'text-gray-300' : 'text-gray-600'} rounded-lg`}
                          variant="secondary">
                          <FiX className="h-3 w-3" />
                          {t('options_models_providers_btnCancel')}
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Provider Configuration Fields */}
                <div className="space-y-3">
                  {/* API Key */}
                  <div className="flex items-center">
                    <label className={`w-24 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('image_generation_apiKey')}
                    </label>
                    <div className="flex flex-1 items-center gap-2">
                      <input
                        type={visibleApiKeys[providerId] ? 'text' : 'password'}
                        value={config.apiKey || ''}
                        onChange={e => handleApiKeyChange(providerId, e.target.value)}
                        placeholder="sk-..."
                        className={`flex-1 rounded-md border ${isDarkMode ? 'border-slate-500 bg-slate-600 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-1.5 text-sm`}
                      />
                      <button
                        onClick={() => toggleApiKeyVisibility(providerId)}
                        className={`p-1.5 rounded-md ${isDarkMode ? 'bg-slate-600 hover:bg-slate-500' : 'bg-gray-100 hover:bg-gray-200'}`}>
                        {visibleApiKeys[providerId] ? (
                          <FiEyeOff className={`h-4 w-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`} />
                        ) : (
                          <FiEye className={`h-4 w-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`} />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Base URL (only for custom providers) */}
                  {config.type === ImageProviderTypeEnum.CustomOpenAI && (
                    <div className="flex items-center">
                      <label className={`w-24 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        {t('image_generation_baseUrl')}
                      </label>
                      <input
                        type="text"
                        value={config.baseUrl || ''}
                        onChange={e => handleBaseUrlChange(providerId, e.target.value)}
                        placeholder={t('image_generation_baseUrl_placeholder')}
                        className={`flex-1 rounded-md border ${isDarkMode ? 'border-slate-500 bg-slate-600 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-1.5 text-sm`}
                      />
                    </div>
                  )}

                  {/* Models */}
                  <div className="flex items-start">
                    <label
                      className={`w-24 pt-1.5 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('image_generation_models')}
                    </label>
                    <div className="flex-1">
                      <div className="flex flex-wrap gap-2 mb-2">
                        {(config.modelNames || []).map(model => (
                          <span
                            key={model}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-sm ${isDarkMode ? 'bg-slate-600 text-gray-300' : 'bg-gray-100 text-gray-700'}`}>
                            {model}
                            <button
                              onClick={() => removeModel(providerId, model)}
                              className={`hover:${isDarkMode ? 'text-red-400' : 'text-red-500'}`}>
                              <FiX className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newModelInputs[providerId] || ''}
                          onChange={e => setNewModelInputs(prev => ({ ...prev, [providerId]: e.target.value }))}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              addModel(providerId, newModelInputs[providerId] || '');
                            }
                          }}
                          placeholder="Add model name..."
                          className={`flex-1 rounded-md border ${isDarkMode ? 'border-slate-500 bg-slate-600 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-1.5 text-sm`}
                        />
                        <Button
                          onClick={() => addModel(providerId, newModelInputs[providerId] || '')}
                          className={`px-3 py-1.5 ${isDarkMode ? 'bg-sky-800' : 'bg-sky-500'} text-white rounded-md`}
                          variant="primary">
                          <FiPlus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Default Model */}
                  <div className="flex items-center">
                    <label className={`w-24 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('image_generation_defaultModel')}
                    </label>
                    <select
                      value={config.defaultModel || ''}
                      onChange={e => handleDefaultModelChange(providerId, e.target.value)}
                      className={`flex-1 rounded-md border ${isDarkMode ? 'border-slate-500 bg-slate-600 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-1.5 text-sm`}>
                      {(config.modelNames || []).map(model => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Default Size */}
                  <div className="flex items-center">
                    <label className={`w-24 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('image_generation_defaultSize')}
                    </label>
                    <select
                      value={config.defaultSize || '1024x1024'}
                      onChange={e => handleDefaultSizeChange(providerId, e.target.value)}
                      className={`flex-1 rounded-md border ${isDarkMode ? 'border-slate-500 bg-slate-600 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-1.5 text-sm`}>
                      {availableSizes.map(size => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
