import { imageProviderStore, type ImageProviderConfig, ImageProviderTypeEnum } from '@extension/storage';
import { createLogger } from '../../log';

const logger = createLogger('ImageGenerationService');

// Image generation request parameters
export interface ImageGenerationRequest {
  prompt: string;
  model?: string; // Model name (e.g., 'gpt-image-2', 'dall-e-3')
  size?: string; // Image size (e.g., '1024x1024', '3840x2160')
  quality?: string; // Image quality (e.g., 'standard', 'high', 'low')
  n?: number; // Number of images to generate (default: 1)
  outputFormat?: string; // Output format (e.g., 'png', 'jpg', 'webp')
  responseFormat?: string; // Response format ('url' or 'b64_json')
}

// Image generation result
export interface ImageGenerationResult {
  success: boolean;
  images?: Array<{
    b64_json?: string; // Base64 encoded image data
    url?: string; // URL to the image
    revisedPrompt?: string; // Revised prompt used by the model
  }>;
  error?: string;
  duration?: number; // Time taken in ms
}

/**
 * Image Generation Service
 * Handles image generation API calls for various providers
 */
export class ImageGenerationService {
  /**
   * Generate images using the active provider
   */
  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const startTime = Date.now();

    try {
      // Get active provider configuration
      const providerConfig = await imageProviderStore.getActiveProviderConfig();

      if (!providerConfig || !providerConfig.apiKey) {
        return {
          success: false,
          error: 'No image provider configured or API key is missing. Please configure an image provider in settings.',
          duration: Date.now() - startTime,
        };
      }

      // Generate images using the appropriate provider
      const result = await this.callImageAPI(providerConfig, request);

      return {
        ...result,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Image generation failed:', errorMessage);

      return {
        success: false,
        error: errorMessage,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Generate images using a specific provider
   */
  async generateImageWithProvider(providerId: string, request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const startTime = Date.now();

    try {
      const providerConfig = await imageProviderStore.getProvider(providerId);

      if (!providerConfig || !providerConfig.apiKey) {
        return {
          success: false,
          error: `Image provider "${providerId}" not configured or API key is missing.`,
          duration: Date.now() - startTime,
        };
      }

      const result = await this.callImageAPI(providerConfig, request);

      return {
        ...result,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Image generation with provider ${providerId} failed:`, errorMessage);

      return {
        success: false,
        error: errorMessage,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Call the image generation API based on provider type
   */
  private async callImageAPI(
    config: ImageProviderConfig,
    request: ImageGenerationRequest,
  ): Promise<ImageGenerationResult> {
    const providerType = config.type || ImageProviderTypeEnum.CustomOpenAI;

    // Build the API request
    const model = request.model || config.defaultModel || 'dall-e-3';
    const size = request.size || config.defaultSize || '1024x1024';
    const quality = request.quality || 'standard';
    const n = request.n || 1;
    const responseFormat = request.responseFormat || 'b64_json';
    const outputFormat = request.outputFormat || 'png';

    // Determine the API endpoint
    // Handle baseUrl that may already include /images/generations path
    let baseUrl = config.baseUrl || this.getDefaultBaseUrl(providerType);
    // Normalize: remove trailing /images/generations if present
    baseUrl = baseUrl.replace(/\/images\/generations$/, '');
    const endpoint = `${baseUrl}/images/generations`;

    logger.info('Calling image generation API:', endpoint, model, size);

    // Build request body based on provider type
    const requestBody = this.buildRequestBody(providerType, {
      model,
      prompt: request.prompt,
      size,
      quality,
      n,
      responseFormat,
      outputFormat,
    });

    // Make the API call
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Image API error response:', response.status, errorText);
      return {
        success: false,
        error: `API error (${response.status}): ${errorText}`,
      };
    }

    const responseData = await response.json();
    logger.info('Image API response received');

    // Parse the response
    return this.parseApiResponse(responseData);
  }

  /**
   * Get default base URL for provider type
   */
  private getDefaultBaseUrl(providerType: ImageProviderTypeEnum): string {
    switch (providerType) {
      case ImageProviderTypeEnum.OpenAI:
        return 'https://api.openai.com/v1';
      default:
        return 'https://api.openai.com/v1'; // Default to OpenAI
    }
  }

  /**
   * Build request body based on provider type
   */
  private buildRequestBody(
    providerType: ImageProviderTypeEnum,
    params: {
      model: string;
      prompt: string;
      size: string;
      quality: string;
      n: number;
      responseFormat: string;
      outputFormat: string;
    },
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: params.model,
      prompt: params.prompt,
      size: params.size,
      n: params.n,
    };

    // Add provider-specific parameters
    switch (providerType) {
      case ImageProviderTypeEnum.OpenAI:
        // OpenAI DALL-E API format
        body.quality = params.quality;
        body.response_format = params.responseFormat;
        break;

      default:
        // Custom OpenAI-compatible format (like packyapi.com)
        body.quality = params.quality;
        body.output_format = params.outputFormat;
        body.response_format = params.responseFormat;
        break;
    }

    return body;
  }

  /**
   * Parse API response
   */
  private parseApiResponse(responseData: unknown): ImageGenerationResult {
    try {
      // Handle OpenAI-style response format
      const data = responseData as {
        data?: Array<{
          b64_json?: string;
          url?: string;
          revised_prompt?: string;
        }>;
        created?: number;
      };

      if (data.data && Array.isArray(data.data)) {
        return {
          success: true,
          images: data.data.map(item => ({
            b64_json: item.b64_json,
            url: item.url,
            revisedPrompt: item.revised_prompt,
          })),
        };
      }

      // Handle unexpected response format
      logger.error('Unexpected API response format:', JSON.stringify(responseData));
      return {
        success: false,
        error: 'Unexpected API response format',
      };
    } catch (parseError) {
      logger.error('Failed to parse API response:', parseError);
      return {
        success: false,
        error: 'Failed to parse API response',
      };
    }
  }

  /**
   * Test provider connection
   */
  async testProviderConnection(providerId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const config = await imageProviderStore.getProvider(providerId);

      if (!config) {
        return { success: false, error: `Provider "${providerId}" not found` };
      }

      if (!config.apiKey) {
        return { success: false, error: 'API key is required' };
      }

      // Make a minimal test request
      const testRequest: ImageGenerationRequest = {
        prompt: 'A simple test image',
        size: '1024x1024',
        n: 1,
        responseFormat: 'url', // Use URL format to avoid large response
      };

      const result = await this.generateImageWithProvider(providerId, testRequest);

      return {
        success: result.success,
        error: result.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Test connection failed',
      };
    }
  }

  /**
   * List available models for a provider
   */
  async listAvailableModels(providerId: string): Promise<string[]> {
    const config = await imageProviderStore.getProvider(providerId);
    if (!config) {
      return [];
    }
    return config.modelNames || [];
  }
}

// Default singleton instance
export const imageGenerationService = new ImageGenerationService();
