import { resolve } from 'node:path';
import { withPageConfig } from '@extension/vite-config';

const rootDir = resolve(__dirname);
const srcDir = resolve(rootDir, 'src');

export default withPageConfig({
  resolve: {
    alias: {
      '@src': srcDir,
    },
  },
  publicDir: resolve(rootDir, 'public'),
  build: {
    outDir: resolve(rootDir, '..', '..', 'dist', 'options'),
    rollupOptions: {
      output: {
        manualChunks: {
          // Heavy graph editing libs — only loaded when WorkflowEditor is opened
          'workflow-vendor': ['@xyflow/react', 'dagre'],
          // React + ecosystem
          'react-vendor': ['react', 'react-dom', 'react-icons/fi'],
        },
      },
    },
  },
});
