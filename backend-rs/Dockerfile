# syntax=docker/dockerfile:1

FROM rust:1.88-slim-bookworm AS builder

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libssl-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY migrations ./migrations

ARG CARGO_BUILD_JOBS=2
RUN cargo build --locked --release --workspace --bins --jobs "${CARGO_BUILD_JOBS}"

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --home-dir /home/hms --shell /usr/sbin/nologin hms

COPY --from=builder /app/target/release/hms-api /usr/local/bin/hms-api
COPY --from=builder /app/target/release/hms-migrator /usr/local/bin/hms-migrator
COPY --from=builder /app/target/release/hms-openapi /usr/local/bin/hms-openapi
COPY --from=builder /app/target/release/hms-worker /usr/local/bin/hms-worker

USER hms
EXPOSE 8080 8081

CMD ["hms-api"]
