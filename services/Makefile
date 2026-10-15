.PHONY: generate fmt fmt-check test race vet check build

generate:
	go generate ./ent ./screenshot-studio-backend/ent

fmt:
	gofmt -w .

fmt-check:
	@test -z "$$(gofmt -l .)" || { gofmt -l .; exit 1; }

test:
	go test ./...

race:
	go test -race ./backend/internal/httpapi ./internal/postiz ./internal/publishing ./internal/temporalpublishing

vet:
	go vet ./...

check: generate fmt-check test race vet
	git diff --exit-code -- ent screenshot-studio-backend/ent

build:
	go build ./backend/cmd/backend ./cmd/platform-migrate ./orchestrator/cmd/orchestrator ./screenshot-studio-backend/backend/cmd/screenshot-studio-backend ./screenshot-studio-backend/orchestrator/cmd/screenshot-studio-orchestrator ./screenshot-studio-backend/cmd/postiz-migrate
