# syntax=docker/dockerfile:1

FROM node:22-alpine AS frontend
WORKDIR /build/spa
COPY spa/package.json spa/package-lock.json ./
RUN npm ci
COPY spa/index.html spa/vite.config.js ./
COPY spa/css ./css
COPY spa/public ./public
COPY spa/src ./src
RUN npm run build

FROM rust:1.97.1-slim-trixie AS builder
WORKDIR /build

# Cache dependency compilation until the manifest or lockfile changes.
COPY backend/Cargo.toml backend/Cargo.lock ./
RUN mkdir src \
    && printf 'fn main() {}\n' > src/main.rs \
    && cargo build --release --locked \
    && rm -rf src

COPY backend/src ./src
COPY backend/migrations ./migrations
RUN touch src/main.rs \
    && cargo build --release --locked \
    && strip target/release/misu-backend

FROM debian:13.6-slim AS runtime

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 misu \
    && useradd --system --uid 10001 --gid misu --home-dir /app --shell /usr/sbin/nologin misu \
    && mkdir -p /app \
    && chown misu:misu /app

WORKDIR /app
COPY --from=builder --chown=misu:misu /build/target/release/misu-backend /usr/local/bin/misu-backend
COPY --chown=misu:misu backend/static ./static
COPY --from=frontend --chown=misu:misu /build/spa/dist ./spa

ENV MISU_BIND=0.0.0.0:8080 \
    MISU_STATIC_DIR=/app/static \
    MISU_SPA_DIR=/app/spa \
    MISU_COOKIE_SECURE=1 \
    RUST_LOG=info

EXPOSE 8080

USER misu:misu
ENTRYPOINT ["/usr/local/bin/misu-backend"]
