@echo off
echo ======================================================================
echo  SWARMNET — Delay-Tolerant Satellite Constellation Simulator
echo ======================================================================
echo.

echo [1/3] Checking Python environment...
python --version
if errorlevel 1 (
    echo Python is not found in PATH. Please install Python 3.11+.
    exit /b 1
)

echo [2/3] Starting SWARMNET FastAPI Backend (Port 8000)...
start "SWARMNET Backend" cmd /k "cd backend && python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"

timeout /t 2 >nul

echo [3/3] Starting SWARMNET React Dashboard (Port 3000)...
start "SWARMNET Frontend" cmd /k "cd frontend && npm run dev"

echo.
echo ======================================================================
echo  SWARMNET services started!
echo  Backend API: http://127.0.0.1:8000
echo  API Docs:    http://127.0.0.1:8000/docs
echo  Dashboard:   http://localhost:3000 (or http://localhost:5173)
echo ======================================================================
echo.
