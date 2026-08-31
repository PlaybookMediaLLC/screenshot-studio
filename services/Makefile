.PHONY: generate fmt fmt-check test race vet check build

generate:
	go generate ./ent

fmt:
	gofmt -w .

fmt-check:
	@test -z "$$(gofmt -l .)" || { gofmt -l .; exit 1; }

test:
	go test ./...

race:
	go test -race ./backend/internal/httpapi ./internal/postiz ./internal/publishing ./internal/storage ./orchestrator/internal/worker

vet:
	go vet ./...

check: generate fmt-check test race vet
	git diff --exit-code -- ent

build:
	go build ./backend/cmd/backend ./orchestrator/cmd/orchestrator
