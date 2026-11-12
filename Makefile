.PHONY: help setup test lint run-backend run-frontend demo experiment docker-up docker-down clean

help:
	@echo "Available commands:"
	@echo "  make setup        - Install backend and frontend dependencies"
	@echo "  make test         - Run pytest test suite"
	@echo "  make lint         - Run linters on backend and frontend"
	@echo "  make run-backend  - Start the FastAPI backend"
	@echo "  make run-frontend - Start Vite frontend dashboard"
	@echo "  make demo         - Run both backend and frontend for live demo"
	@echo "  make experiment   - Execute systematic benchmark comparison"
	@echo "  make docker-up    - Build and launch multi-container stack"
	@echo "  make docker-down  - Stop all running Docker containers"

setup:
	cd backend && pip install -r requirements.txt
	cd frontend && npm install

test:
	cd backend && pytest -v

lint:
	cd backend && ruff check . || true
	cd frontend && npm run lint || true

run-backend:
	cd backend && uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

run-frontend:
	cd frontend && npm run dev

demo:
	python scripts/run_experiments.py

experiment:
	cd backend && python -m app.experiments.runner

docker-up:
	docker compose up --build

docker-down:
	docker compose down

clean:
	rm -rf backend/__pycache__ backend/*/__pycache__ backend/*/*/__pycache__
	rm -rf data/experiments/*.json data/experiments/*.csv
