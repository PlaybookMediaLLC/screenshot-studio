.PHONY: generate fmt fmt-check test race vet check build

generate:
	go generate ./ent ./internal/social/ent

fmt:
	gofmt -w .

fmt-check:
	@test -z "$$(gofmt -l .)" || { gofmt -l .; exit 1; }

test:
	go test ./...

race:
	go test -race ./internal/httpapi ./internal/postiz ./internal/publishing ./internal/temporalpublishing ./internal/onboarding ./internal/temporalonboarding ./internal/enrichment

vet:
	go vet ./...

check: generate fmt-check test race vet
	git diff --exit-code -- ent internal/social/ent

build:
	go build ./cmd/...
