import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { FaImage } from 'react-icons/fa';
import { FiStar } from 'react-icons/fi';
import { t } from '@extension/i18n';
import SkillQuickSelect, { SkillTag } from './SkillQuickSelect';
import WorkflowQuickSelect from './WorkflowQuickSelect';
import type { Skill } from '@extension/skills';

interface ChatInputProps {
  onSendMessage: (
    text: string,
    displayText?: string,
    images?: { name: string; base64: string }[],
    skill?: Skill | null,
  ) => void;
  onStopTask: () => void;
  onGenerateImage?: () => void;
  disabled: boolean;
  showStopButton: boolean;
  setContent?: (setter: (text: string) => void) => void;
  isDarkMode?: boolean;
  onExecuteSkill?: (skillId: string, params: Record<string, unknown>) => void;
  onExecuteWorkflow?: (workflowId: string) => void;
}

interface AttachedFile {
  name: string;
  content: string;
  type: string;
}

interface AttachedImage {
  id: string;
  base64: string;
  previewUrl: string;
  name: string;
  size: number; // in KB
}

// Generate unique ID
const generateId = () => Math.random().toString(36).substring(2, 9);

export default function ChatInput({
  onSendMessage,
  onStopTask,
  onGenerateImage,
  disabled,
  showStopButton,
  setContent,
  isDarkMode = false,
  onExecuteSkill,
  onExecuteWorkflow,
}: ChatInputProps) {
  const [text, setText] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [isPasteHintVisible, setIsPasteHintVisible] = useState(false);

  const isSendButtonDisabled = useMemo(
    () => disabled || (text.trim() === '' && attachedFiles.length === 0 && attachedImages.length === 0),
    [disabled, text, attachedFiles, attachedImages],
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 100)}px`;
    }
  };

  useEffect(() => {
    if (setContent) setContent(setText);
  }, [setContent]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 100)}px`;
    }
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmedText = text.trim();
      if (!trimmedText && attachedFiles.length === 0 && attachedImages.length === 0 && !selectedSkill) return;

      let messageContent = trimmedText;
      let displayContent = trimmedText;

      // 处理文件附件
      if (attachedFiles.length > 0) {
        const fileContents = attachedFiles
          .map(f => `\n\n<nano_file_content type="file" name="${f.name}">\n${f.content}\n</nano_file_content>`)
          .join('\n');
        messageContent = trimmedText
          ? `${trimmedText}\n\n<nano_attached_files>${fileContents}</nano_attached_files>`
          : `<nano_attached_files>${fileContents}</nano_attached_files>`;
        const fileList = attachedFiles.map(f => `📎 ${f.name}`).join('\n');
        displayContent = trimmedText ? `${trimmedText}\n\n${fileList}` : fileList;
      }

      // 处理图片附件 - 将图片 base64 信息包含在消息中
      if (attachedImages.length > 0) {
        const imageInfo = attachedImages
          .map(
            img =>
              `<nano_attached_image name="${img.name}" size="${img.size}KB" base64_length="${img.base64.length}" />`,
          )
          .join('\n');

        if (messageContent) {
          messageContent = `${messageContent}\n\n<nano_attached_images>\n${imageInfo}\n</nano_attached_images>`;
        } else {
          messageContent = `<nano_attached_images>\n${imageInfo}\n</nano_attached_images>`;
        }

        // 注意：图片 base64 数据通过 sendMessage 的额外参数传递
        const imageList = attachedImages.map(img => `🖼️ ${img.name} (${img.size}KB)`).join('\n');
        displayContent = displayContent ? `${displayContent}\n\n${imageList}` : imageList;
      }

      // 将图片数据作为额外参数传递
      const imageData =
        attachedImages.length > 0 ? attachedImages.map(img => ({ name: img.name, base64: img.base64 })) : undefined;

      // 调用扩展的 onSendMessage（支持图片参数和 skill 参数）
      onSendMessage(messageContent, displayContent, imageData, selectedSkill);

      // 清理状态
      setText('');
      setAttachedFiles([]);
      attachedImages.forEach(img => URL.revokeObjectURL(img.previewUrl));
      setAttachedImages([]);
      setSelectedSkill(null);
    },
    [text, attachedFiles, attachedImages, selectedSkill, onSendMessage],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleSubmit(e);
      }
    },
    [handleSubmit],
  );

  const handleFileSelect = useCallback(() => fileInputRef.current?.click(), []);
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const newFiles: AttachedFile[] = [];
    const allowedTypes = ['.txt', '.md', '.markdown', '.json', '.csv', '.log', '.xml', '.yaml', '.yml'];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      if (!allowedTypes.includes(ext)) continue;
      if (file.size > 1024 * 1024) continue;
      try {
        newFiles.push({ name: file.name, content: await file.text(), type: file.type || 'text/plain' });
      } catch (err) {
        console.error(`Error reading ${file.name}:`, err);
      }
    }
    if (newFiles.length > 0) setAttachedFiles(prev => [...prev, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleRemoveFile = useCallback(
    (index: number) => setAttachedFiles(prev => prev.filter((_, i) => i !== index)),
    [],
  );

  // ===== 图片处理 =====

  // 处理图片文件
  const processImageFile = useCallback(async (file: File): Promise<AttachedImage | null> => {
    // 检查文件类型
    if (!file.type.startsWith('image/')) {
      console.warn('非图片文件:', file.name);
      return null;
    }

    // 检查文件大小 (最大 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      console.warn('图片过大:', file.name, `${Math.round(file.size / 1024)}KB`);
      return null;
    }

    try {
      // 读取为 base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // 提取纯 base64 数据（去掉 data:image/xxx;base64, 前缀）
          const base64Data = result.split(',')[1];
          resolve(base64Data);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      // 创建预览 URL
      const previewUrl = URL.createObjectURL(file);

      return {
        id: generateId(),
        base64,
        previewUrl,
        name: file.name,
        size: Math.round(file.size / 1024),
      };
    } catch (err) {
      console.error('图片读取失败:', file.name, err);
      return null;
    }
  }, []);

  // 图片选择按钮点击
  const handleImageSelect = useCallback(() => imageInputRef.current?.click(), []);

  // 图片文件选择
  const handleImageChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      const newImages: AttachedImage[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const image = await processImageFile(file);
        if (image) newImages.push(image);
      }

      if (newImages.length > 0) {
        setAttachedImages(prev => [...prev, ...newImages]);
      }

      if (imageInputRef.current) imageInputRef.current.value = '';
    },
    [processImageFile],
  );

  // 移除图片
  const handleRemoveImage = useCallback((id: string) => {
    setAttachedImages(prev => {
      const image = prev.find(img => img.id === id);
      if (image) {
        URL.revokeObjectURL(image.previewUrl); // 清理预览 URL
      }
      return prev.filter(img => img.id !== id);
    });
  }, []);

  // 粘贴处理
  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        // 检查是否是图片
        if (item.type.startsWith('image/')) {
          e.preventDefault(); // 阻止默认粘贴行为

          const file = item.getAsFile();
          if (file) {
            const image = await processImageFile(file);
            if (image) {
              setAttachedImages(prev => [...prev, image]);
              setIsPasteHintVisible(true);
              setTimeout(() => setIsPasteHintVisible(false), 2000);
            }
          }
          return;
        }
      }
    },
    [processImageFile],
  );

  // Handle skill selection
  const handleSkillSelected = useCallback((skill: Skill | null) => {
    setSelectedSkill(skill);
  }, []);

  // Handle remove selected skill
  const handleRemoveSkill = useCallback(() => {
    setSelectedSkill(null);
  }, []);

  // Handle execute selected skill directly
  const handleExecuteSelectedSkill = useCallback(() => {
    if (selectedSkill && onExecuteSkill) {
      // Execute with empty params if no required params
      const params: Record<string, unknown> = {};
      selectedSkill.parameters.forEach(p => {
        if (p.default !== undefined) {
          params[p.name] = p.default;
        }
      });
      onExecuteSkill(selectedSkill.id, params);
      setSelectedSkill(null);
    }
  }, [selectedSkill, onExecuteSkill]);

  return (
    <form
      ref={containerRef}
      onSubmit={handleSubmit}
      className={`relative overflow-hidden rounded-lg border transition-colors duration-300 ${
        disabled ? 'opacity-55' : ''
      } ${
        isDarkMode ? 'border-jade-border/30 bg-jade-card/25' : 'border-[var(--border-color)] bg-[var(--bg-surface)]'
      }`}
      aria-label={t('chat_input_form')}>
      <div className="flex flex-col">
        {/* 粘贴提示 */}
        {isPasteHintVisible && (
          <div
            className={`absolute top-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-md text-xs z-10 ${
              isDarkMode ? 'bg-green-900/80 text-green-300' : 'bg-green-100 text-green-700'
            }`}>
            📋 图片已粘贴！按 Ctrl+V 可继续添加图片
          </div>
        )}

        {/* 图片预览 */}
        {attachedImages.length > 0 && (
          <div
            className={`flex flex-wrap gap-2 border-b p-2 ${
              isDarkMode ? 'border-jade-border/20' : 'border-[var(--border-color)]'
            }`}>
            {attachedImages.map(img => (
              <div
                key={img.id}
                className={`relative group flex items-center gap-2 px-2 py-1 rounded-md ${
                  isDarkMode ? 'bg-slate-700/50' : 'bg-gray-100'
                }`}>
                <img src={img.previewUrl} alt={img.name} className="w-12 h-12 object-cover rounded border" />
                <div className="flex flex-col text-xs">
                  <span className={`truncate max-w-[80px] ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    {img.name}
                  </span>
                  <span className={`${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>{img.size}KB</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveImage(img.id)}
                  className={`absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity ${
                    isDarkMode ? 'bg-red-500/80 text-white' : 'bg-red-500 text-white'
                  }`}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Skill 标签显示 */}
        {selectedSkill && (
          <div
            className={`flex flex-wrap gap-2 border-b p-2 ${
              isDarkMode ? 'border-jade-border/20' : 'border-[var(--border-color)]'
            }`}>
            <SkillTag
              skill={selectedSkill}
              onRemove={handleRemoveSkill}
              onExecute={selectedSkill.parameters.length === 0 ? handleExecuteSelectedSkill : undefined}
              isDarkMode={isDarkMode}
            />
          </div>
        )}

        {/* 文件附件 */}
        {attachedFiles.length > 0 && (
          <div
            className={`flex flex-wrap gap-2 border-b p-2 ${
              isDarkMode ? 'border-jade-border/20' : 'border-[var(--border-color)]'
            }`}>
            {attachedFiles.map((f, i) => (
              <div key={i} className="file-tag">
                <span>📎</span>
                <span className="truncate">{f.name}</span>
                <button type="button" onClick={() => handleRemoveFile(i)} className="remove-btn">
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 输入框 */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={disabled}
          aria-disabled={disabled}
          rows={5}
          className={`jade-input w-full resize-none px-3 py-2.5 text-sm ${
            disabled
              ? isDarkMode
                ? 'cursor-not-allowed bg-ink-800/40 text-gray-500'
                : 'cursor-not-allowed bg-gray-100 text-gray-400'
              : isDarkMode
                ? 'bg-transparent text-gray-200'
                : 'bg-transparent text-gray-700'
          }`}
          placeholder={
            attachedFiles.length > 0 || attachedImages.length > 0
              ? 'Add a message (optional)...'
              : t('chat_input_placeholder') + ' (支持 Ctrl+V 粘贴图片)'
          }
          aria-label={t('chat_input_editor')}
        />

        {/* 底部工具栏 */}
        <div
          className={`flex items-center justify-between border-t px-3 py-1.5 ${
            isDarkMode ? 'border-jade-border/15' : 'border-[var(--border-color)]'
          }`}>
          <div className="flex gap-0.5" style={{ color: `var(--text-muted)` }}>
            {/* 图片上传按钮 */}
            <button
              type="button"
              onClick={handleImageSelect}
              disabled={disabled}
              aria-label="Attach images"
              title="上传图片 (或 Ctrl+V 粘贴)"
              className={`icon-btn rounded-md ${disabled ? '!opacity-35 cursor-not-allowed' : ''}`}>
              <FaImage className="size-4" />
            </button>
            <input
              ref={imageInputRef}
              type="file"
              multiple
              accept="image/*"
              onChange={handleImageChange}
              className="hidden"
              aria-hidden="true"
            />
            {/* 文件上传按钮 */}
            <button
              type="button"
              onClick={handleFileSelect}
              disabled={disabled}
              aria-label="Attach files"
              title="Attach text files"
              className={`icon-btn rounded-md ${disabled ? '!opacity-35 cursor-not-allowed' : ''}`}>
              <span className="text-base">📎</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".txt,.md,.markdown,.json,.csv,.log,.xml,.yaml,.yml"
              onChange={handleFileChange}
              className="hidden"
              aria-hidden="true"
            />
            {/* Skill 快速执行 */}
            {onExecuteSkill && (
              <SkillQuickSelect
                isDarkMode={isDarkMode}
                onExecuteSkill={onExecuteSkill}
                onSkillSelected={handleSkillSelected}
                disabled={disabled}
              />
            )}
            {/* Workflow 快速执行 */}
            {onExecuteWorkflow && (
              <WorkflowQuickSelect isDarkMode={isDarkMode} onExecuteWorkflow={onExecuteWorkflow} disabled={disabled} />
            )}
            {/* 图片生成按钮 */}
            {onGenerateImage && (
              <button
                type="button"
                onClick={onGenerateImage}
                disabled={disabled}
                aria-label={t('image_generation_title')}
                title={t('image_generation_title')}
                className={`icon-btn rounded-md ${disabled ? '!opacity-35 cursor-not-allowed' : ''} ${
                  isDarkMode ? 'hover:bg-purple-500/20' : 'hover:bg-purple-100'
                }`}>
                <FiStar className={`size-4 ${isDarkMode ? 'text-purple-400' : 'text-purple-500'}`} />
              </button>
            )}
          </div>

          {/* 操作按钮 */}
          {showStopButton ? (
            <button
              type="button"
              onClick={onStopTask}
              className="jade-btn jade-btn-danger rounded-lg px-4 py-1.5 text-xs">
              {t('chat_buttons_stop')}
            </button>
          ) : (
            <button
              type="submit"
              disabled={isSendButtonDisabled}
              aria-disabled={isSendButtonDisabled}
              className={`jade-btn rounded-lg px-5 py-1.5 text-xs font-semibold tracking-wider ${isSendButtonDisabled ? '!opacity-45' : ''}`}>
              {t('chat_buttons_send')}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
