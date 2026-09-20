@echo off
setlocal enabledelayedexpansion
echo =======================================================
echo          Columbia 3.0 Application Bundler
echo =======================================================
echo.

set "ROOT_DIR=%~dp0"
set "FRONTEND_DIR=%ROOT_DIR%frontend"
set "BACKEND_DIR=%ROOT_DIR%backend"
set "PYTHON_EXE=%ROOT_DIR%\.venv\Scripts\python.exe"

if not exist "%PYTHON_EXE%" (
    echo [ERROR] Python environment not found at: %PYTHON_EXE%
    echo Please make sure backend\env exists and has python installed.
    pause
    exit /b 1
)

:: Step 1: Build Frontend (Vite)
echo [1/3] Checking frontend build...
if exist "%FRONTEND_DIR%\node_modules" (
    echo Building Vite frontend...
    cd /d "%FRONTEND_DIR%"
    call npm run build
    if errorlevel 1 (
        echo [WARNING] npm run build failed. Continuing if frontend\dist already exists.
    )
) else (
    echo [INFO] frontend\node_modules not found, checking existing frontend\dist...
)

if not exist "%FRONTEND_DIR%\dist\index.html" (
    echo [ERROR] frontend\dist\index.html not found! Please build the frontend first.
    pause
    exit /b 1
)
echo [OK] Frontend dist confirmed.
echo.

:: Step 2: Run PyInstaller
echo [2/3] Bundling backend with PyInstaller (launcher.spec)...
cd /d "%BACKEND_DIR%"
"%PYTHON_EXE%" -m PyInstaller --noconfirm launcher.spec
if errorlevel 1 (
    echo [ERROR] PyInstaller build failed.
    pause
    exit /b 1
)
echo.

:: Step 3: Verify Output
echo [3/3] Verifying output bundle...
if exist "%BACKEND_DIR%\dist\columbia\columbia.exe" (
    echo.
    echo =======================================================
    echo           BUNDLE COMPLETED SUCCESSFULLY!
    echo =======================================================
    echo Output directory: %BACKEND_DIR%\dist\columbia
    echo Executable:       %BACKEND_DIR%\dist\columbia\columbia.exe
    echo.
) else (
    echo [ERROR] Output columbia.exe was not created in backend\dist\columbia.
    pause
    exit /b 1
)

cd /d "%ROOT_DIR%"
echo Done!
