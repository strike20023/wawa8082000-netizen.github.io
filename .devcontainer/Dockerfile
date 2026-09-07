FROM nocodb/nocodb:2026.06.0

USER root
RUN if command -v apk >/dev/null 2>&1; then \
      apk add --no-cache bash git curl; \
    elif command -v apt-get >/dev/null 2>&1; then \
      apt-get update && apt-get install -y --no-install-recommends bash git curl \
      && rm -rf /var/lib/apt/lists/*; \
    else \
      echo "Unsupported base image: package manager not found" >&2; exit 1; \
    fi
