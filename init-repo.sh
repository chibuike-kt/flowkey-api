#!/bin/bash
# =============================================================================
# FLOWKEY — REPO INITIALISATION SCRIPT
# =============================================================================
# Run this once after cloning to set up the repository from scratch.
# This script is for documentation purposes — run commands manually.
# =============================================================================

# Step 1: Initialise git repo
git init
git checkout -b develop  # develop is the integration branch

# Step 2: Install dependencies (this also runs husky via `prepare` script)
npm install

# Step 3: Set up husky hooks
npx husky init
echo "npx commitlint --edit \$1" > .husky/commit-msg
echo "npm run lint && npm run typecheck" > .husky/pre-push
chmod +x .husky/commit-msg
chmod +x .husky/pre-push

# Step 4: Generate Prisma client (placeholder schema for now)
npm run db:generate

# Step 5: Initial commit — chore type (no feature, no application logic)
git add .
git commit -m "chore(repo): initialise flowkey-api project scaffold

- Node 22 + TypeScript strict mode
- Express app factory with Helmet, CORS, Morgan
- Prisma + PostgreSQL (schema placeholder — full schema in Phase 3)
- Redis singleton + BullMQ connection factory
- Config service: dotenv (dev) + AWS Secrets Manager (prod)
- AppError class with ErrorCode enum and HTTP status map
- Standard API response envelope (ApiSuccess / ApiError)
- Global error handler and 404 handler
- Structured logger (JSON/pretty)
- Docker Compose: Postgres 16 + Redis 7 (localhost-only binding)
- GitHub Actions CI: commitlint, typecheck, lint, unit + integration tests
- Jest config with 100% coverage threshold
- ESLint + Prettier + commitlint + husky hooks
- ADL.md and SECURITY.md initialised
- README with full developer onboarding guide
- Phase 2 smoke tests"

# Step 6: Tag the phase
git tag -a phase-2/env-repo-setup -m "Phase 2 complete: environment and repo setup"

echo ""
echo "Repository initialised on branch: develop"
echo "Phase 2 tagged: phase-2/env-repo-setup"
echo ""
echo "Next steps:"
echo "  1. Create the remote repo on GitHub (name: flowkey-api)"
echo "  2. git remote add origin git@github.com:YOUR_ORG/flowkey-api.git"
echo "  3. git push -u origin develop"
echo "  4. Protect both 'main' and 'develop' branches in GitHub repo settings"
echo "  5. Set required status checks: commitlint, static-analysis, unit-tests, integration-tests, build"
echo "  6. Generate local JWT keys: make keys"
echo "  7. Configure .env with your local credentials"
echo "  8. make up && make migrate && make dev"
