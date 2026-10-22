#!/bin/sh
set -eu

architecture="${1:-arm64}"
case "$architecture" in
  arm64|arm/v7|amd64) ;;
  *)
    echo "Usage: $0 [arm64|arm/v7|amd64]" >&2
    exit 2
    ;;
esac

archive_arch=$(printf '%s' "$architecture" | tr '/' '-')
archive="clairty-portal-${archive_arch}.tar"

docker buildx build \
  --platform "linux/$architecture" \
  --tag "clairty-portal:$archive_arch" \
  --load \
  .

docker save --output "$archive" "clairty-portal:$archive_arch"

echo "Created $archive"
