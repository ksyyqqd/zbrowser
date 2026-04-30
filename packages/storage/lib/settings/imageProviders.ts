import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';
import { ImageProviderTypeEnum, imageProviderModelNames, imageProviderSizes } from './types';

// Interface for a single image provider configuration
export interface ImageProviderConfig {
  name?: string; // Display name in the options
  type?: ImageProviderTypeEnum; // Help to decide which API format to use
  apiKey: string; // Must be provided
  baseUrl?: string; // Optional base URL for custom providers
  modelNames?: string[]; // Available model names
  defaultModel?: string; // Default model to use
  defaultSize?: string; // Default image size
  createdAt?: number; // Timestamp in milliseconds when the provider was created
}

// Interface for storing multiple image provider configurations
export interface ImageProviderRecord {
  providers: Record<string, ImageProviderConfig>;
  activeProvider?: string; // The currently active provider ID
}

export type ImageProviderStorage = BaseStorage<ImageProviderRecord> & {
  setProvider: (providerId: string, config: ImageProviderConfig) => Promise<void>;
  getProvider: (providerId: string) => Promise<ImageProviderConfig | undefined>;
  removeProvider: (providerId: string) => Promise<void>;
  hasProvider: (providerId: string) => Promise<boolean>;
  getAllProviders: () => Promise<Record<string, ImageProviderConfig>>;
  setActiveProvider: (providerId: string) => Promise<void>;
  getActiveProvider: () => Promise<string | undefined>;
  getActiveProviderConfig: () => Promise<ImageProviderConfig | undefined>;
};

// Helper function to determine provider type from provider name
export function getImageProviderTypeByProviderId(providerId: string): ImageProviderTypeEnum {
  switch (providerId) {
    case ImageProviderTypeEnum.OpenAI:
      return ImageProviderTypeEnum.OpenAI;
    default:
      return ImageProviderTypeEnum.CustomOpenAI;
  }
}

// Helper function to get display name from provider id
export function getDefaultDisplayNameFromImageProviderId(providerId: string): string {
  switch (providerId) {
    case ImageProviderTypeEnum.OpenAI:
      return 'OpenAI';
    default:
      return providerId; // Use the provider id as display name for custom providers
  }
}

// Get default configuration for built-in image providers
export function getDefaultImageProviderConfig(providerId: string): ImageProviderConfig {
  const modelNames = imageProviderModelNames[providerId as keyof typeof imageProviderModelNames] || [];
  const sizes = imageProviderSizes[providerId as keyof typeof imageProviderSizes] || ['1024x1024'];

  switch (providerId) {
    case ImageProviderTypeEnum.OpenAI:
      return {
        apiKey: '',
        name: getDefaultDisplayNameFromImageProviderId(providerId),
        type: ImageProviderTypeEnum.OpenAI,
        modelNames: [...modelNames],
        defaultModel: modelNames[0] || 'dall-e-3',
        defaultSize: sizes[0] || '1024x1024',
        createdAt: Date.now(),
      };
    default: // Handles CustomOpenAI
      return {
        apiKey: '',
        name: getDefaultDisplayNameFromImageProviderId(providerId),
        type: ImageProviderTypeEnum.CustomOpenAI,
        baseUrl: '',
        modelNames: [...modelNames],
        defaultModel: modelNames[0] || 'gpt-image-2',
        defaultSize: sizes[0] || '1024x1024',
        createdAt: Date.now(),
      };
  }
}

// Helper function to ensure backward compatibility for provider configs
function ensureBackwardCompatibility(providerId: string, config: ImageProviderConfig): ImageProviderConfig {
  const updatedConfig = { ...config };

  // Ensure name exists
  if (!updatedConfig.name) {
    updatedConfig.name = getDefaultDisplayNameFromImageProviderId(providerId);
  }
  // Ensure type exists
  if (!updatedConfig.type) {
    updatedConfig.type = getImageProviderTypeByProviderId(providerId);
  }

  // Ensure modelNames exists
  if (!updatedConfig.modelNames) {
    updatedConfig.modelNames = imageProviderModelNames[providerId as keyof typeof imageProviderModelNames] || [];
  }

  // Ensure defaultModel exists
  if (!updatedConfig.defaultModel) {
    updatedConfig.defaultModel = updatedConfig.modelNames[0] || 'dall-e-3';
  }

  // Ensure defaultSize exists
  if (!updatedConfig.defaultSize) {
    const sizes = imageProviderSizes[providerId as keyof typeof imageProviderSizes] || ['1024x1024'];
    updatedConfig.defaultSize = sizes[0];
  }

  // Ensure createdAt exists
  if (!updatedConfig.createdAt) {
    updatedConfig.createdAt = Date.now();
  }

  return updatedConfig;
}

// Storage for image provider configurations
const storage = createStorage<ImageProviderRecord>(
  'image-providers',
  { providers: {} },
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  },
);

export const imageProviderStore: ImageProviderStorage = {
  ...storage,

  async setProvider(providerId: string, config: ImageProviderConfig) {
    if (!providerId) {
      throw new Error('Provider id cannot be empty');
    }

    if (config.apiKey === undefined) {
      throw new Error('API key must be provided');
    }

    const providerType = config.type || getImageProviderTypeByProviderId(providerId);

    // For custom providers, baseUrl is required
    if (providerType === ImageProviderTypeEnum.CustomOpenAI) {
      if (!config.baseUrl?.trim()) {
        console.warn(
          `Custom image provider ${providerId} is being saved without baseUrl. Default OpenAI endpoint will be used.`,
        );
      }
    }

    const completeConfig: ImageProviderConfig = {
      apiKey: config.apiKey || '',
      baseUrl: config.baseUrl,
      name: config.name || getDefaultDisplayNameFromImageProviderId(providerId),
      type: providerType,
      modelNames: config.modelNames || [],
      defaultModel: config.defaultModel || config.modelNames?.[0] || 'dall-e-3',
      defaultSize: config.defaultSize || '1024x1024',
      createdAt: config.createdAt || Date.now(),
    };

    const current = (await storage.get()) || { providers: {} };
    await storage.set({
      ...current,
      providers: {
        ...current.providers,
        [providerId]: completeConfig,
      },
    });
  },

  async getProvider(providerId: string) {
    const data = (await storage.get()) || { providers: {} };
    const config = data.providers[providerId];
    return config ? ensureBackwardCompatibility(providerId, config) : undefined;
  },

  async removeProvider(providerId: string) {
    const current = (await storage.get()) || { providers: {} };
    const newProviders = { ...current.providers };
    delete newProviders[providerId];
    // If removing the active provider, clear activeProvider
    const activeProvider = current.activeProvider === providerId ? undefined : current.activeProvider;
    await storage.set({ providers: newProviders, activeProvider });
  },

  async hasProvider(providerId: string) {
    const data = (await storage.get()) || { providers: {} };
    return providerId in data.providers;
  },

  async getAllProviders() {
    const data = await storage.get();
    const providers = { ...data.providers };

    // Add backward compatibility for all providers
    for (const [providerId, config] of Object.entries(providers)) {
      providers[providerId] = ensureBackwardCompatibility(providerId, config);
    }

    return providers;
  },

  async setActiveProvider(providerId: string) {
    const current = (await storage.get()) || { providers: {} };
    if (!(providerId in current.providers)) {
      throw new Error(`Provider ${providerId} does not exist`);
    }
    await storage.set({ ...current, activeProvider: providerId });
  },

  async getActiveProvider() {
    const data = await storage.get();
    return data.activeProvider;
  },

  async getActiveProviderConfig() {
    const data = await storage.get();
    if (!data.activeProvider) {
      return undefined;
    }
    const config = data.providers[data.activeProvider];
    return config ? ensureBackwardCompatibility(data.activeProvider, config) : undefined;
  },
};
