# Makefile — common tasks for local dev and CI

.PHONY: dev build-server build-client deploy clean

# ── Local development ────────────────────────────────────────────────────────

dev: build-server
	@echo "Starting Nakama stack…"
	docker compose up -d
	@echo "Starting Vite dev server…"
	cd client && npm install && npm run dev

# ── Server build ─────────────────────────────────────────────────────────────

build-server:
	@echo "Building Nakama TypeScript runtime…"
	cd server && npm install && npm run build
	@echo "Server bundle → server/dist/main.js"

# ── Client build ─────────────────────────────────────────────────────────────

build-client:
	@echo "Building React client…"
	cd client && npm install && npm run build
	@echo "Client build → client/dist/"

# ── Production deploy (DigitalOcean / any Docker host) ───────────────────────
# Set NAKAMA_SERVER_KEY, NAKAMA_CONSOLE_PASSWORD, ACME_EMAIL in .env.prod

deploy: build-server
	docker compose -f docker-compose.yml -f docker-compose.prod.yml \
		--env-file .env.prod up -d --build
	@echo "Deployed. Nakama console: https://api.yourdomain.com (port 7351)"

# ── Logs ─────────────────────────────────────────────────────────────────────

logs:
	docker compose logs -f nakama

# ── Clean ────────────────────────────────────────────────────────────────────

clean:
	docker compose down -v
	rm -rf server/dist client/dist
