FROM golang:1.26-alpine AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG GO_BUILD_TAGS=""
RUN CGO_ENABLED=0 go build -tags "$GO_BUILD_TAGS" -trimpath -ldflags="-s -w" -o /out/screenshot-studio-backend ./cmd/social-api
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/postiz-migrate ./cmd/postiz-migrate
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/platform-migrate ./cmd/platform-migrate
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/publishing-orchestrator ./cmd/product-worker
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/publishing-backend ./cmd/product-api
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/combined-backend ./cmd/combined

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/screenshot-studio-backend /screenshot-studio-backend
COPY --from=build /out/postiz-migrate /postiz-migrate
COPY --from=build /out/platform-migrate /platform-migrate
COPY --from=build /out/publishing-orchestrator /publishing-orchestrator
COPY --from=build /out/publishing-backend /publishing-backend
COPY --from=build /out/combined-backend /combined-backend
ENV TZ=UTC
EXPOSE 3000
EXPOSE 3003
ENTRYPOINT ["/combined-backend"]
