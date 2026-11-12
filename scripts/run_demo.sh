#!/usr/bin/env bash
set -e

echo "======================================================================"
echo " SWARMNET — Delay-Tolerant Satellite Constellation Simulator"
echo "======================================================================"
echo ""

echo "[1/3] Checking environment..."
python3 --version || python --version
node --version

echo "[2/3] Starting Backend API in background (Port 8000)..."
cd backend
python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!
cd ..

sleep 2

echo "[3/3] Starting Frontend Dashboard..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "======================================================================"
echo " SWARMNET is running!"
echo " Backend:   http://127.0.0.1:8000"
echo " API Docs:  http://127.0.0.1:8000/docs"
echo " Dashboard: http://localhost:3000 (or http://localhost:5173)"
echo " Press Ctrl+C to terminate both servers."
echo "======================================================================"

trap "kill $BACKEND_PID $FRONTEND_PID" EXIT
wait
