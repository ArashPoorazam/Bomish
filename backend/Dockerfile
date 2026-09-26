FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /server ./cmd/server
FROM alpine:3.23
RUN apk add --no-cache ca-certificates && addgroup -S bomish && adduser -S bomish -G bomish && mkdir -p /data/uploads && chown -R bomish:bomish /data
USER bomish
WORKDIR /app
COPY --from=build /server /app/server
ENV LISTEN_ADDR=0.0.0.0:8080 UPLOAD_DIR=/data/uploads
EXPOSE 8080
ENTRYPOINT ["/app/server"]
