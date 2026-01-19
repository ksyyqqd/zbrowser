@echo off
setlocal enabledelayedexpansion

echo Starting build process...

REM Run ready script
call ready_script.bat

REM Clean dist directory
if exist dist rmdir /s /q dist
mkdir dist 2>nul

REM Build packages in order of dependencies
echo Building shared package...
cd packages\shared
call pnpm run ready
if errorlevel 1 goto error
cd ..\..

echo Building schema-utils package...
cd packages\schema-utils
call pnpm run ready
if errorlevel 1 goto error
cd ..\..

echo Building i18n package...
cd packages\i18n
call pnpm run ready
if errorlevel 1 goto error
cd ..\..

echo Building storage package...
cd packages\storage
call pnpm run ready
if errorlevel 1 goto error
cd ..\..

echo Building ui package...
cd packages\ui
call pnpm run ready
if errorlevel 1 goto error
cd ..\..

echo Building dev-utils package...
cd packages\dev-utils
call pnpm run ready
if errorlevel 1 goto error
cd ..\..

echo Building hmr package...
cd packages\hmr
call pnpm run ready
if errorlevel 1 goto error
cd ..\..

@REM echo Building tailwind-config package...
@REM cd packages\tailwind-config
@REM call pnpm run ready
@REM if errorlevel 1 goto error
@REM cd ..\..

@REM echo Building vite-config package...
@REM cd packages\vite-config
@REM REM This package doesn't have a ready script, so we continue
@REM cd ..\..

echo Building zipper package...
cd packages\zipper
call pnpm run ready
if errorlevel 1 goto error
cd ..\..

REM Build pages
echo Building content page...
cd pages\content
call pnpm run build
if errorlevel 1 goto error
cd ..\..

echo Building options page...
cd pages\options
call pnpm run build
if errorlevel 1 goto error
cd ..\..

echo Building side-panel page...
cd pages\side-panel
call pnpm run build
if errorlevel 1 goto error
cd ..\..

REM Build main chrome extension
echo Building chrome extension...
cd chrome-extension
call pnpm run build
if errorlevel 1 goto error
cd ..

echo Build completed successfully!
goto end

:error
echo Build failed with error level %ERRORLEVEL%
exit /b %ERRORLEVEL%

:end
endlocal