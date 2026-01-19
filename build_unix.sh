#!/bin/bash

set -e  # Exit on any error

echo "Starting build process..."

# Run ready script
./ready_script.sh 2>/dev/null || echo "Ready script not found or not executable, continuing..."

# Clean dist directory
rm -rf dist
mkdir -p dist

# Build packages in order of dependencies
echo "Building shared package..."
cd packages/shared
pnpm run ready
cd ../../

echo "Building schema-utils package..."
cd packages/schema-utils
pnpm run ready
cd ../../

echo "Building i18n package..."
cd packages/i18n
pnpm run ready
cd ../../

echo "Building storage package..."
cd packages/storage
pnpm run ready
cd ../../

echo "Building ui package..."
cd packages/ui
pnpm run ready
cd ../../

echo "Building dev-utils package..."
cd packages/dev-utils
pnpm run ready
cd ../../

echo "Building hmr package..."
cd packages/hmr
pnpm run ready
cd ../../

# echo "Building tailwind-config package..."
# cd packages/tailwind-config
# pnpm run ready
# cd ../../

# echo "Building vite-config package..."
# cd packages/vite-config
# # This package doesn't have a ready script, so we continue
# cd ../../

echo "Building zipper package..."
cd packages/zipper
pnpm run ready
cd ../../

# Build pages
echo "Building content page..."
cd pages/content
pnpm run build
cd ../..

echo "Building options page..."
cd pages/options
pnpm run build
cd ../..

echo "Building side-panel page..."
cd pages/side-panel
pnpm run build
cd ../..

# Build main chrome extension
echo "Building chrome extension..."
cd chrome-extension
pnpm run build
cd ..

echo "Build completed successfully!"