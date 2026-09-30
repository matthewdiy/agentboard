#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/upload-document.sh <document> [title] [path]

Environment:
  AGENTBOARD_URL    Agentboard base URL, for example https://agentboard.example.com
  AGENTBOARD_TOKEN  API key with documents:write permission
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ $# -lt 1 || $# -gt 3 ]]; then
  usage >&2
  exit 2
fi

: "${AGENTBOARD_URL:?Set AGENTBOARD_URL before uploading}"
: "${AGENTBOARD_TOKEN:?Set AGENTBOARD_TOKEN before uploading}"

document=$1
title=${2:-}
path=${3:-}

if [[ ! -f "$document" ]]; then
  printf 'Document not found: %s\n' "$document" >&2
  exit 1
fi

extension=${document##*.}
extension=$(printf '%s' "$extension" | tr '[:upper:]' '[:lower:]')
case "$extension" in
  md|markdown|html|htm) ;;
  *)
    printf 'Unsupported document type: %s\n' "$document" >&2
    printf 'Use a .md, .markdown, .html, or .htm file.\n' >&2
    exit 1
    ;;
esac

curl_args=(
  --fail-with-body
  --silent
  --show-error
  --request POST
  "${AGENTBOARD_URL%/}/api/v1/documents"
  --header "Authorization: Bearer $AGENTBOARD_TOKEN"
  --form "document=@$document"
  --form-string 'manifest=[]'
)

if [[ -n "$title" ]]; then
  curl_args+=(--form-string "title=$title")
fi

if [[ -n "$path" ]]; then
  curl_args+=(--form-string "path=$path")
fi

curl "${curl_args[@]}"
printf '\n'
