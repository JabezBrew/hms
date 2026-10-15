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
ARG TARGETARCH
ARG TARGETVARIANT
RUN --mount=type=cache,id=hms-rust-registry,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,id=hms-rust-git,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,id=hms-rust-1.88-bookworm-${TARGETARCH}${TARGETVARIANT},target=/app/target,sharing=locked \
    find crates migrations -type f -exec touch {} + \
    && cargo build --locked --release --workspace --bins --jobs "${CARGO_BUILD_JOBS}" \
    && mkdir -p /out \
    && cp target/release/hms-api target/release/hms-migrator \
          target/release/hms-openapi target/release/hms-worker /out/

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --home-dir /home/hms --shell /usr/sbin/nologin hms

COPY --from=builder /out/hms-api /usr/local/bin/hms-api
COPY --from=builder /out/hms-migrator /usr/local/bin/hms-migrator
COPY --from=builder /out/hms-openapi /usr/local/bin/hms-openapi
COPY --from=builder /out/hms-worker /usr/local/bin/hms-worker

USER hms
EXPOSE 8080 8081

CMD ["hms-api"]
