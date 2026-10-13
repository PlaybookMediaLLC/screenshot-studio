FROM golang:1.26-alpine AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG GO_BUILD_TAGS=""
RUN CGO_ENABLED=0 go build -tags "$GO_BUILD_TAGS" -trimpath -ldflags="-s -w" -o /out/screenshot-studio-orchestrator ./screenshot-studio-backend/orchestrator/cmd/screenshot-studio-orchestrator

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/screenshot-studio-orchestrator /screenshot-studio-orchestrator
ENV TZ=UTC
EXPOSE 3002
ENTRYPOINT ["/screenshot-studio-orchestrator"]
