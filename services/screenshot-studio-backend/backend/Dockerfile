FROM golang:1.26-alpine AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/screenshot-studio-backend ./screenshot-studio-backend/backend/cmd/screenshot-studio-backend
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/postiz-migrate ./screenshot-studio-backend/cmd/postiz-migrate
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/publishing-orchestrator ./orchestrator/cmd/orchestrator
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/combined-backend ./screenshot-studio-backend/backend/cmd/combined-backend

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/screenshot-studio-backend /screenshot-studio-backend
COPY --from=build /out/postiz-migrate /postiz-migrate
COPY --from=build /out/publishing-orchestrator /publishing-orchestrator
COPY --from=build /out/combined-backend /combined-backend
ENV TZ=UTC
EXPOSE 3000
EXPOSE 3003
ENTRYPOINT ["/combined-backend"]
