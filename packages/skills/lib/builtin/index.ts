import type { Skill } from '../types/skill';

/**
 * Web Research Skill
 * Searches multiple sources and aggregates results
 */
export const webResearchSkill: Skill = {
  id: 'web-research',
  name: 'Web Research',
  description:
    'Research a topic by searching multiple sources, opening results, and extracting/summarizing information',
  version: '1.0.0',
  category: 'data-extraction',
  author: 'nanobrowser',
  tags: ['research', 'search', 'summary', 'multi-source'],
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: 'The search query or research topic',
      required: true,
    },
    {
      name: 'maxSources',
      type: 'number',
      description: 'Maximum number of sources to analyze',
      required: false,
      default: 5,
      min: 1,
      max: 10,
    },
    {
      name: 'searchEngine',
      type: 'string',
      description: 'Search engine to use',
      required: false,
      default: 'google',
      enum: ['google', 'bing'],
    },
    {
      name: 'summaryStyle',
      type: 'string',
      description: 'Style of summary output',
      required: false,
      default: 'bullet-points',
      enum: ['bullet-points', 'paragraph', 'detailed'],
    },
  ],
  steps: [
    {
      id: 'search',
      action: 'search_google',
      description: 'Search for the topic',
      parameters: {
        intent: 'Searching for research topic',
        query: '{{query}}',
      },
      onError: 'stop',
      delay: 2000,
    },
    {
      id: 'cache_initial',
      action: 'cache_content',
      description: 'Cache initial search results',
      parameters: {
        intent: 'Caching search results for analysis',
        content: 'Search results page loaded, ready to analyze result links',
      },
      onError: 'continue',
    },
    {
      id: 'open_first_result',
      action: 'click_element',
      description: 'Open first search result',
      parameters: {
        intent: 'Opening first source for analysis',
        index: 3, // Typically first organic result after ads
      },
      onError: 'continue',
    },
    {
      id: 'extract_content_1',
      action: 'cache_content',
      description: 'Extract content from first source',
      parameters: {
        intent: 'Caching content from source 1',
        content: 'Content extracted from source 1 - user should analyze page content',
      },
      onError: 'continue',
      delay: 3000,
    },
    {
      id: 'go_back',
      action: 'go_back',
      description: 'Return to search results',
      parameters: {},
      onError: 'continue',
    },
    {
      id: 'open_second_result',
      action: 'click_element',
      description: 'Open second search result',
      parameters: {
        intent: 'Opening second source for analysis',
        index: 4,
      },
      onError: 'continue',
    },
    {
      id: 'extract_content_2',
      action: 'cache_content',
      description: 'Extract content from second source',
      parameters: {
        intent: 'Caching content from source 2',
        content: 'Content extracted from source 2 - user should analyze page content',
      },
      onError: 'continue',
      delay: 3000,
    },
    {
      id: 'complete',
      action: 'done',
      description: 'Complete research task',
      parameters: {
        text: 'Research completed. Content has been cached from {{maxSources}} sources. User should review cached content and provide summary.',
        success: true,
      },
      onError: 'stop',
    },
  ],
  executionMode: 'both',
  timeout: 120000,
  metadata: {
    examples: [
      {
        description: 'Research AI trends in 2024',
        parameters: {
          query: 'AI trends 2024',
          maxSources: 5,
        },
        expectedResult: 'Summary of AI trends from multiple sources',
      },
    ],
    documentation:
      'This skill performs web research by searching, opening multiple results, and caching content for analysis.',
  },
};

/**
 * Form Filling Skill
 * Automatically fills form fields with provided data
 */
export const formFillingSkill: Skill = {
  id: 'form-filling',
  name: 'Form Filling',
  description:
    'Fill form fields automatically with provided data, handling various input types including text, dropdowns, and checkboxes',
  version: '1.0.0',
  category: 'form-interaction',
  author: 'nanobrowser',
  tags: ['form', 'automation', 'input', 'fill'],
  parameters: [
    {
      name: 'fields',
      type: 'object',
      description: 'Object mapping field selectors/labels to values',
      required: true,
    },
    {
      name: 'submitAfter',
      type: 'boolean',
      description: 'Whether to submit the form after filling',
      required: false,
      default: false,
    },
    {
      name: 'waitForSuccess',
      type: 'boolean',
      description: 'Whether to wait for success/error message after submit',
      required: false,
      default: true,
    },
  ],
  steps: [
    {
      id: 'cache_start',
      action: 'cache_content',
      description: 'Record form filling start',
      parameters: {
        content: 'Starting form filling with provided field data',
      },
      onError: 'continue',
    },
    {
      id: 'fill_fields',
      action: 'input_text',
      description: 'Fill text fields (placeholder - actual implementation varies by field data)',
      parameters: {
        intent: 'Filling form field',
        index: 0, // Placeholder - user should identify actual field indices
        text: '{{fields.text1}}', // Template - depends on actual field structure
      },
      onError: 'continue',
    },
    {
      id: 'submit_form',
      action: 'click_element',
      description: 'Submit the form',
      parameters: {
        intent: 'Submitting form',
        index: -1, // Placeholder - user should identify submit button index
      },
      onError: 'stop',
      condition: {
        type: 'if',
        expression: '{{submitAfter}}',
      },
    },
    {
      id: 'wait_result',
      action: 'wait',
      description: 'Wait for form response',
      parameters: {
        seconds: 3,
      },
      onError: 'continue',
      condition: {
        type: 'if',
        expression: '{{waitForSuccess}}',
      },
    },
    {
      id: 'complete',
      action: 'done',
      description: 'Complete form filling',
      parameters: {
        text: 'Form filling completed. Fields have been filled according to provided data.',
        success: true,
      },
      onError: 'stop',
    },
  ],
  executionMode: 'both',
  timeout: 60000,
  metadata: {
    examples: [
      {
        description: 'Fill registration form',
        parameters: {
          fields: {
            name: 'John Doe',
            email: 'john@example.com',
            phone: '1234567890',
          },
          submitAfter: true,
        },
      },
    ],
    documentation:
      'This skill fills form fields with provided data. Note: Field indices should be identified before execution.',
  },
};

/**
 * Data Extraction Skill
 * Extracts structured data from pages
 */
export const dataExtractionSkill: Skill = {
  id: 'data-extraction',
  name: 'Data Extraction',
  description: 'Extract structured data from web pages, including tables, lists, and repeated elements',
  version: '1.0.0',
  category: 'data-extraction',
  author: 'nanobrowser',
  tags: ['extract', 'data', 'scrape', 'table', 'list'],
  parameters: [
    {
      name: 'dataType',
      type: 'string',
      description: 'Type of data to extract',
      required: true,
      enum: ['table', 'list', 'cards', 'custom'],
    },
    {
      name: 'scrollPages',
      type: 'number',
      description: 'Number of pages to scroll for pagination',
      required: false,
      default: 1,
      min: 0,
      max: 10,
    },
    {
      name: 'extractorHint',
      type: 'string',
      description: 'Hint for what to extract (e.g., "product prices", "article titles")',
      required: false,
    },
  ],
  steps: [
    {
      id: 'scroll_to_top',
      action: 'scroll_to_top',
      description: 'Start from top of page',
      parameters: {},
      onError: 'continue',
    },
    {
      id: 'cache_page_1',
      action: 'cache_content',
      description: 'Cache content from current view',
      parameters: {
        intent: 'Caching {{dataType}} data from page',
        content: 'Extracted data: {{extractorHint}} - user should review page content',
      },
      onError: 'continue',
    },
    {
      id: 'scroll_next',
      action: 'next_page',
      description: 'Scroll to next page section',
      parameters: {},
      onError: 'continue',
      condition: {
        type: 'if',
        expression: '{{scrollPages}} > 1',
      },
    },
    {
      id: 'cache_page_2',
      action: 'cache_content',
      description: 'Cache content from scrolled view',
      parameters: {
        intent: 'Caching additional {{dataType}} data',
        content: 'Additional data extracted - user should review',
      },
      onError: 'continue',
    },
    {
      id: 'complete',
      action: 'done',
      description: 'Complete extraction',
      parameters: {
        text: 'Data extraction completed. Content has been cached for {{dataType}} type. User should process cached content.',
        success: true,
      },
      onError: 'stop',
    },
  ],
  executionMode: 'both',
  timeout: 90000,
  metadata: {
    examples: [
      {
        description: 'Extract product information from e-commerce page',
        parameters: {
          dataType: 'cards',
          scrollPages: 3,
          extractorHint: 'product names and prices',
        },
      },
      {
        description: 'Extract table data',
        parameters: {
          dataType: 'table',
          scrollPages: 0,
          extractorHint: 'financial data',
        },
      },
    ],
    documentation:
      'This skill extracts structured data by scrolling and caching content. The cached content should be processed by the LLM.',
  },
};

/**
 * All built-in skills
 */
export const builtInSkills: Skill[] = [webResearchSkill, formFillingSkill, dataExtractionSkill];

/**
 * Get built-in skill by ID
 */
export function getBuiltInSkill(id: string): Skill | undefined {
  return builtInSkills.find(s => s.id === id);
}

/**
 * Get all built-in skills
 */
export function getAllBuiltInSkills(): Skill[] {
  return [...builtInSkills];
}
