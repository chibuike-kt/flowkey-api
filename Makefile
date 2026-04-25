# =============================================================================
# FLOWKEY API — MAKEFILE
# =============================================================================
# Common development commands. Requires make, Node 22, Docker, and npm.
#
# Usage:
#   make dev          — start dev server with hot reload
#   make up           — start Docker Compose services (Postgres + Redis)
#   make down         — stop Docker Compose services
#   make migrate      — run pending Prisma migrations (dev)
#   make generate     — regenerate Prisma client after schema change
#   make test         — run all tests
#   make test-unit    — run unit tests only
#   make test-int     — run integration tests (requires Docker services up)
#   make lint         — run ESLint
#   make format       — run Prettier (writes files)
#   make typecheck    — run TypeScript type check
#   make build        — compile TypeScript to dist/
#   make clean        — remove dist/ and coverage/
#   make keys         — generate RS256 key pair for local dev (saves to secrets/)
# =============================================================================

.PHONY: all dev up down migrate generate test test-unit test-int test-cov \
        lint format typecheck build clean keys seed

# Default target
all: up generate migrate

# Start dev server
dev:
	npm run dev

# Start infrastructure services
up:
	docker compose up -d
	@echo "Waiting for Postgres to be ready..."
	@until docker exec flowkey_postgres pg_isready -U flowkey -d flowkey_db > /dev/null 2>&1; do sleep 1; done
	@echo "Postgres is ready."
	@echo "Waiting for Redis to be ready..."
	@until docker exec flowkey_redis redis-cli -a flowkey_dev_redis_password ping > /dev/null 2>&1; do sleep 1; done
	@echo "Redis is ready."

# Stop infrastructure services
down:
	docker compose down

# Run Prisma migrations (dev mode — creates migration files)
migrate:
	npm run migrate:dev

# Deploy migrations (no new migration files — for CI/production)
migrate-deploy:
	npm run migrate:deploy

# Generate Prisma client
generate:
	npm run db:generate

# Seed database
seed:
	npm run db:seed

# Run all tests
test:
	npm test

# Unit tests only
test-unit:
	npm run test:unit

# Integration tests (requires Docker services)
test-int:
	npm run test:integration

# Concurrency tests
test-concurrency:
	npm run test:concurrency

# Failure path tests
test-failure:
	npm run test:failure

# Tests with coverage report
test-cov:
	npm run test:coverage

# Lint
lint:
	npm run lint

# Format (writes files)
format:
	npm run format

# TypeScript type check
typecheck:
	npm run typecheck

# Build
build:
	npm run build

# Clean build and coverage artifacts
clean:
	rm -rf dist/ coverage/

# Generate RS256 key pair for local development
# Keys are saved to secrets/ directory (gitignored)
# Copy the output into your .env file
keys:
	@mkdir -p secrets
	@openssl genrsa -out secrets/private.pem 4096
	@openssl rsa -in secrets/private.pem -pubout -out secrets/public.pem
	@echo ""
	@echo "Keys generated in secrets/"
	@echo ""
	@echo "Add to your .env:"
	@echo "JWT_PRIVATE_KEY=$(shell awk '{printf "%s\\n", $$0}' secrets/private.pem)"
	@echo "JWT_PUBLIC_KEY=$(shell awk '{printf "%s\\n", $$0}' secrets/public.pem)"
