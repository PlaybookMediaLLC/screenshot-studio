SHELL := /bin/bash

STUDIO := ./bin/studio
NAMESPACE ?= screenshot-studio
SERVICE ?=
COMPONENT ?= screenshot-studio
TAIL ?= 200
E2E_BASE_URL ?= http://localhost:3000

.DEFAULT_GOAL := help

.PHONY: help up down reset status smoke rate-limit-smoke tenant-isolation e2e e2e-file e2e-onboarding e2e-recovery check publishing-up publishing-down publishing-test logs logs-app logs-postgres logs-redis logs-minio logs-storage trigger-login trigger-config trigger-dev kind-up kind-down kind-status kind-logs

help: ## Show local development commands.
	@echo "Screenshot Studio local development"
	@echo ""
	@echo "  make up                         Start the hot-reload Compose stack"
	@echo "  make down                       Stop Compose and ask about local data"
	@echo "  make reset                      Stop Compose and remove local data"
	@echo "  make status                     Show Compose service status"
	@echo "  make smoke                      Verify the running Compose stack"
	@echo "  make rate-limit-smoke           Verify Redis-backed API rate limiting"
	@echo "  make tenant-isolation           Verify two-organization session and API-key isolation"
	@echo "  make e2e                        Run all browser end-to-end flows"
	@echo "  make e2e-file SPEC=e2e/foo.ts   Run one browser end-to-end flow"
	@echo "  make e2e-onboarding             Verify sign-up and workspace onboarding in Chromium"
	@echo "  make e2e-recovery               Verify dependency failure and recovery behavior"
	@echo "  make check                      Run lint and TypeScript checks"
	@echo "  make publishing-up              Start the Go backend and orchestrator profile"
	@echo "  make publishing-down            Stop the Go publishing services"
	@echo "  make publishing-test            Run Go generation, tests, race checks, and vet"
	@echo ""
	@echo "  make logs [SERVICE=app]         Follow Compose logs"
	@echo "  make logs-app                   Follow app logs"
	@echo "  make logs-postgres              Follow Postgres logs"
	@echo "  make logs-redis                 Follow Redis logs"
	@echo "  make logs-minio                 Follow MinIO logs"
	@echo "  make logs-storage               Follow Supabase Storage logs"
	@echo ""
	@echo "  make trigger-login              Log in to Trigger.dev Cloud"
	@echo "  make trigger-config PROJECT_REF=proj_xxx"
	@echo "  make trigger-dev                Start the local Trigger.dev worker"
	@echo ""
	@echo "  make kind-up                    Build and install the Kind stack"
	@echo "  make kind-down                  Delete the Kind cluster after confirmation"
	@echo "  make kind-status                Show Kind workloads and jobs"
	@echo "  make kind-logs [COMPONENT=screenshot-studio] [TAIL=200]"

up:
	@$(STUDIO) up

down:
	@$(STUDIO) down

reset:
	@$(STUDIO) reset

status:
	@$(STUDIO) status

smoke:
	@$(STUDIO) smoke

rate-limit-smoke:
	@$(STUDIO) rate-limit-smoke

tenant-isolation:
	@$(STUDIO) tenant-isolation

e2e:
	@E2E_BASE_URL="$(E2E_BASE_URL)" $(STUDIO) e2e

e2e-file:
	@test -n "$(SPEC)" || { echo "Usage: make e2e-file SPEC=e2e/example.spec.ts" >&2; exit 2; }
	@E2E_BASE_URL="$(E2E_BASE_URL)" $(STUDIO) e2e-file "$(SPEC)"

e2e-onboarding:
	@E2E_BASE_URL="$(E2E_BASE_URL)" $(STUDIO) e2e-onboarding

e2e-recovery:
	@E2E_BASE_URL="$(E2E_BASE_URL)" $(STUDIO) e2e-recovery

check:
	@$(STUDIO) check

publishing-up:
	@docker compose --env-file .local/dev.env --file compose.yaml --profile publishing up --detach --build publishing-backend publishing-orchestrator

publishing-down:
	@docker compose --env-file .local/dev.env --file compose.yaml stop publishing-backend publishing-orchestrator

publishing-test:
	@$(MAKE) --directory services check

logs:
	@$(STUDIO) logs $(SERVICE)

logs-app:
	@$(STUDIO) logs app

logs-postgres:
	@$(STUDIO) logs postgres

logs-redis:
	@$(STUDIO) logs redis

logs-minio:
	@$(STUDIO) logs minio

logs-storage:
	@$(STUDIO) logs storage

trigger-login:
	@$(STUDIO) trigger-login

trigger-config:
	@test -n "$(PROJECT_REF)" || { echo "Usage: make trigger-config PROJECT_REF=proj_xxx" >&2; exit 2; }
	@$(STUDIO) trigger-config "$(PROJECT_REF)"

trigger-dev:
	@$(STUDIO) trigger-dev

kind-up:
	@$(STUDIO) kind-up

kind-down:
	@$(STUDIO) kind-down

kind-status:
	@kubectl --namespace "$(NAMESPACE)" get pods,jobs,services

kind-logs:
	@kubectl --namespace "$(NAMESPACE)" logs "deployment/$(COMPONENT)" --follow --tail="$(TAIL)"
