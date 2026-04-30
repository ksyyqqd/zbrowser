import { useState, useRef, useEffect } from 'react';
import { FiX, FiStar, FiDownload, FiRefreshCw } from 'react-icons/fi';
import { t } from '@extension/i18n';
import { Button } from '@extension/ui';
import { imageProviderSizes, imageProviderQualities } from '@extension/storage';

interface ImageGenerationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (params: ImageGenerationParams) => void;
  isGenerating: boolean;
  generatedImage?: string; // base64 data
  isDarkMode?: boolean;
}

export interface ImageGenerationParams {
  prompt: string;
  model?: string;
  size?: string;
  quality?: string;
}

export default function ImageGenerationModal({
  isOpen,
  onClose,
  onGenerate,
  isGenerating,
  generatedImage,
  isDarkMode = false,
}: ImageGenerationModalProps) {
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('1024x1024');
  const [quality, setQuality] = useState('standard');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus textarea when modal opens
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isOpen]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setPrompt('');
    }
  }, [isOpen]);

  const handleGenerate = () => {
    if (!prompt.trim() || isGenerating) return;
    onGenerate({
      prompt: prompt.trim(),
      size,
      quality,
    });
  };

  const handleDownload = () => {
    if (!generatedImage) return;
    const link = document.createElement('a');
    link.href = `data:image/png;base64,${generatedImage}`;
    link.download = `generated-image-${Date.now()}.png`;
    link.click();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleGenerate();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  const sizes = imageProviderSizes['custom_openai'] || ['1024x1024', '1920x1080', '3840x2160'];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}>
      {/* Backdrop */}
      <div
        className={`absolute inset-0 ${isDarkMode ? 'bg-black/60' : 'bg-black/40'} backdrop-blur-sm`}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        className={`relative w-full max-w-lg rounded-xl shadow-2xl ${
          isDarkMode ? 'bg-slate-800 border border-slate-600' : 'bg-white border border-gray-200'
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-gen-title">
        {/* Header */}
        <div
          className={`flex items-center justify-between px-4 py-3 border-b ${
            isDarkMode ? 'border-slate-600' : 'border-gray-200'
          }`}>
          <div className="flex items-center gap-2">
            <FiStar className={`h-5 w-5 ${isDarkMode ? 'text-purple-400' : 'text-purple-500'}`} />
            <h2
              id="image-gen-title"
              className={`text-lg font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
              {t('image_generation_title')}
            </h2>
          </div>
          <button
            onClick={onClose}
            className={`p-1 rounded-md transition-colors ${
              isDarkMode ? 'hover:bg-slate-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'
            }`}
            aria-label="Close">
            <FiX className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Generated Image Display */}
          {generatedImage && (
            <div className={`rounded-lg overflow-hidden ${isDarkMode ? 'bg-slate-700' : 'bg-gray-100'}`}>
              <img
                src={`data:image/png;base64,${generatedImage}`}
                alt="Generated image"
                className="w-full max-h-[300px] object-contain"
              />
              <div
                className={`flex items-center justify-between px-3 py-2 border-t ${
                  isDarkMode ? 'border-slate-600' : 'border-gray-200'
                }`}>
                <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {t('image_generation_result')}
                </span>
                <button
                  onClick={handleDownload}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
                    isDarkMode
                      ? 'bg-slate-600 hover:bg-slate-500 text-gray-300'
                      : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                  }`}>
                  <FiDownload className="h-3 w-3" />
                  {t('chat_download')}
                </button>
              </div>
            </div>
          )}

          {/* Prompt Input */}
          <div>
            <label className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              {t('image_generation_prompt_placeholder')}
            </label>
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={3}
              disabled={isGenerating}
              placeholder="例如: 一只橘猫戴着橙色围巾抱着水獭，温暖插画风格"
              className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm resize-none ${
                isDarkMode
                  ? 'border-slate-500 bg-slate-700 text-gray-200 placeholder:text-gray-500 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20'
                  : 'border-gray-300 bg-white text-gray-700 placeholder:text-gray-400 focus:border-purple-400 focus:ring-2 focus:ring-purple-400/20'
              } ${isGenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
            />
          </div>

          {/* Size Selection */}
          <div>
            <label className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              {t('image_generation_defaultSize')}
            </label>
            <select
              value={size}
              onChange={e => setSize(e.target.value)}
              disabled={isGenerating}
              className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm ${
                isDarkMode
                  ? 'border-slate-500 bg-slate-700 text-gray-200 focus:border-purple-500'
                  : 'border-gray-300 bg-white text-gray-700 focus:border-purple-400'
              } ${isGenerating ? 'opacity-50 cursor-not-allowed' : ''}`}>
              {sizes.map(s => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Quality Selection */}
          <div>
            <label className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              {t('image_generation_quality')}
            </label>
            <select
              value={quality}
              onChange={e => setQuality(e.target.value)}
              disabled={isGenerating}
              className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm ${
                isDarkMode
                  ? 'border-slate-500 bg-slate-700 text-gray-200 focus:border-purple-500'
                  : 'border-gray-300 bg-white text-gray-700 focus:border-purple-400'
              } ${isGenerating ? 'opacity-50 cursor-not-allowed' : ''}`}>
              {imageProviderQualities.map(q => (
                <option key={q} value={q}>
                  {q === 'standard' ? '标准' : q === 'high' ? '高清' : q === 'low' ? '快速' : q}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Footer */}
        <div
          className={`flex items-center justify-end gap-2 px-4 py-3 border-t ${
            isDarkMode ? 'border-slate-600' : 'border-gray-200'
          }`}>
          <Button
            onClick={onClose}
            variant="secondary"
            className={`px-4 py-2 ${
              isDarkMode
                ? 'bg-slate-600 hover:bg-slate-500 text-gray-300'
                : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
            }`}>
            {t('options_models_providers_btnCancel')}
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={!prompt.trim() || isGenerating}
            className={`flex items-center gap-2 px-4 py-2 ${
              isDarkMode ? 'bg-purple-600 hover:bg-purple-500' : 'bg-purple-500 hover:bg-purple-600'
            } text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed`}>
            {isGenerating ? (
              <>
                <FiRefreshCw className="h-4 w-4 animate-spin" />
                {t('image_generation_generating')}
              </>
            ) : (
              <>
                <FiStar className="h-4 w-4" />
                {t('image_generation_generate')}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
