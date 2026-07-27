# syntax=docker/dockerfile:1

FROM rust:1.97.1-slim-trixie AS builder
WORKDIR /build

# Cache dependency compilation until the manifest or lockfile changes.
COPY Cargo.toml Cargo.lock ./
RUN mkdir src \
    && printf 'fn main() {}\n' > src/main.rs \
    && cargo build --release --locked \
    && rm -rf src

COPY src ./src
RUN touch src/main.rs \
    && cargo build --release --locked \
    && strip target/release/misu-backend

FROM debian:13.6-slim AS runtime

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 misu \
    && useradd --system --uid 10001 --gid misu --home-dir /app --shell /usr/sbin/nologin misu \
    && mkdir -p /app /data \
    && chown misu:misu /app /data

WORKDIR /app
COPY --from=builder --chown=misu:misu /build/target/release/misu-backend /usr/local/bin/misu-backend
COPY --chown=misu:misu web ./web
COPY --chown=misu:misu static ./static

ENV MISU_BIND=0.0.0.0:8080 \
    MISU_DB=/data/misu.sqlite \
    MISU_WEB_DIR=/app/web \
    MISU_STATIC_DIR=/app/static \
    RUST_LOG=info

VOLUME ["/data"]
EXPOSE 8080

USER misu:misu
ENTRYPOINT ["/usr/local/bin/misu-backend"]
