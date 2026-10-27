# One image for every environment. Production runs the default entry point,
# cmd/combined, which starts the product API and worker. Compose and kind select one
# binary for each service with the entry point.
FROM golang:1.26-alpine AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG GO_BUILD_TAGS=""
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/social-migrate ./cmd/social-migrate
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/social-credentials ./cmd/social-credentials
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/platform-migrate ./cmd/platform-migrate
RUN CGO_ENABLED=0 go build -tags "$GO_BUILD_TAGS" -trimpath -ldflags="-s -w" -o /out/publishing-orchestrator ./cmd/product-worker
RUN CGO_ENABLED=0 go build -tags "$GO_BUILD_TAGS" -trimpath -ldflags="-s -w" -o /out/publishing-backend ./cmd/product-api
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/combined-backend ./cmd/combined

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/social-migrate /social-migrate
COPY --from=build /out/social-credentials /social-credentials
COPY --from=build /out/platform-migrate /platform-migrate
COPY --from=build /out/publishing-orchestrator /publishing-orchestrator
COPY --from=build /out/publishing-backend /publishing-backend
COPY --from=build /out/combined-backend /combined-backend
ENV TZ=UTC
EXPOSE 3000
EXPOSE 3003
ENTRYPOINT ["/combined-backend"]
