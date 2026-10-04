#!/usr/bin/env python3
"""agentboard - command-line client for the Agentboard document API.

Run `agentboard.py --help` for the full reference, or `<command> --help` for
one command. Python 3.9+, standard library only.

This client mirrors the server's input rules so mistakes surface locally. Keep
it in step with these files when they change:

  lib/documents/paths.ts       document paths, extensions, depth
  lib/documents/processing.ts  image manifest and asset path normalization
  lib/documents/shares.ts      share expiry forms, TTL range, name length
  lib/documents/cursor.ts      page size, list limit, query length
  lib/app env (lib/env.ts)     upload size limits
"""

import argparse
import datetime
import getpass
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

VERSION = "1.0.0"
USER_AGENT = "agentboard-cli/" + VERSION

# Stored credentials: AGENTBOARD_CONFIG, else $XDG_CONFIG_HOME/agentboard/config.json,
# else ~/.config/agentboard/config.json. Environment variables always win over
# the file so CI, sandboxes, and one-off hosts keep working.
CONFIG_ENV_VAR = "AGENTBOARD_CONFIG"
CONFIG_DIR_NAME = "agentboard"
CONFIG_FILE_NAME = "config.json"

# Interactive `config login` gives each prompt this many tries before giving up.
LOGIN_PROMPT_ATTEMPTS = 3

# Mirrors lib/env.ts
MAX_DOCUMENT_BYTES = 4 * 1024 * 1024
MAX_ASSET_BYTES = 4 * 1024 * 1024
MAX_BUNDLE_BYTES = 5 * 1024 * 1024
MAX_ASSET_COUNT = 50

# Mirrors lib/documents/paths.ts
MAX_PATH_LENGTH = 500
MAX_PATH_DEPTH = 64
DOCUMENT_EXTENSIONS = (".md", ".markdown", ".html", ".htm")

# Mirrors lib/documents/processing.ts
MAX_TITLE_LENGTH = 160
IMAGE_MIME_TYPES = {
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}

# Mirrors lib/documents/shares.ts
MIN_SHARE_TTL_SECONDS = 60
MAX_SHARE_TTL_SECONDS = 90 * 24 * 60 * 60
MAX_SHARE_NAME_LENGTH = 80
DEFAULT_SHARE_TTL_SECONDS = 7 * 24 * 60 * 60

# Mirrors lib/documents/cursor.ts
DEFAULT_LIST_LIMIT = 50
MAX_LIST_LIMIT = 100
MAX_QUERY_LENGTH = 200

# Resolution of a /path target pages through list results, bounded so a
# mistyped path can never walk the whole library.
RESOLVE_MAX_PAGES = 5
RESOLVE_PAGE_LIMIT = 100

EXIT_OK = 0
EXIT_USAGE = 2
EXIT_CONFIG = 3
EXIT_AUTH = 4
EXIT_NOT_FOUND = 5
EXIT_CONFLICT = 6
EXIT_INVALID = 7
EXIT_SERVER = 8

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE
)
REMOTE_URL_RE = re.compile(r"^https?://", re.IGNORECASE)
UNSAFE_SCHEME_RE = re.compile(r"^(?:data|javascript|vbscript|file):", re.IGNORECASE)
WINDOWS_DRIVE_RE = re.compile(r"^[a-zA-Z]:")
CONTROL_CHAR_RE = re.compile(r"[\u0000-\u001f\u007f-\u009f]")
DURATION_RE = re.compile(r"^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$")

# The server rewrites these two forms only, so scanning anything narrower would
# miss an image and scanning anything wider would report images it ignores.
MD_IMAGE_RE = re.compile(
    r"(!\[[^\]]*\]\(\s*)(<[^>]+>|\"[^\"\n]*\"|'[^'\n]*'|[^\s)]+)([\s\S]*?\))"
)
HTML_IMAGE_RE = re.compile(
    r"(<img\b[^>]*?\bsrc\s*=\s*)([\"'])([^\"']*)(\2)", re.IGNORECASE
)
MD_REF_IMAGE_RE = re.compile(r"!\[[^\]]*\]\[[^\]]*\]")
SRCSET_RE = re.compile(r"\bsrcset\s*=", re.IGNORECASE)


class CliError(Exception):
    """An expected failure with a message, an optional hint, and an exit code."""

    def __init__(self, message, code=EXIT_USAGE, hint=None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.hint = hint


class ApiError(CliError):
    """A non-2xx response from the server."""

    def __init__(self, status, message, hint=None):
        super().__init__(message, code=exit_code_for_status(status), hint=hint)
        self.status = status


def exit_code_for_status(status):
    if status in (401, 403):
        return EXIT_AUTH
    if status == 404:
        return EXIT_NOT_FOUND
    if status == 409:
        return EXIT_CONFLICT
    if status == 422:
        return EXIT_INVALID
    return EXIT_SERVER


def default_hint(status, base_url):
    if status == 401:
        return (
            "the API token is missing, invalid, or deleted. Create a new key at "
            "%s/settings, then store it with `agentboard.py config set --token-stdin` "
            "or export AGENTBOARD_TOKEN for one call" % base_url
        )
    if status == 403:
        return (
            "the token does not carry the scope this command needs (documents:read or "
            "documents:write); create a key with both scopes at %s/settings" % base_url
        )
    if status == 404:
        return "the document or share link no longer exists; re-run `list` or `search`"
    if status == 409:
        return (
            "the path is already taken; run `tree <parent>` and reuse the existing "
            "entry, or choose a filename its siblings do not use"
        )
    if status == 422:
        return "fix the reported input (file type, image references, sizes, or share expiry) before retrying"
    if status >= 500:
        return "do not blindly retry a create; run `search` first to check whether it succeeded"
    return None


# --------------------------------------------------------------------------
# output helpers


def out(text=""):
    sys.stdout.write(text + "\n")


def out_raw(text):
    sys.stdout.write(text)


def err(text):
    sys.stderr.write(text + "\n")


def print_json(payload):
    out(json.dumps(payload, separators=(",", ":"), ensure_ascii=False))


def print_table(headers, rows):
    if not rows:
        return
    table = [headers] + rows
    widths = [max(len(row[index]) for row in table) for index in range(len(headers))]
    for row in table:
        cells = []
        for index, cell in enumerate(row):
            if index == len(row) - 1:
                cells.append(cell)
            else:
                cells.append(cell.ljust(widths[index]))
        out("  ".join(cells).rstrip())


def fmt_time(value):
    if not value:
        return ""
    text = str(value)
    if len(text) >= 16 and text[10] == "T":
        return text[:16].replace("T", " ")
    return text


def fmt_bytes(count):
    try:
        count = int(count)
    except (TypeError, ValueError):
        return str(count)
    if count < 1024:
        return "%d B" % count
    if count < 1024 * 1024:
        return "%.1f KB" % (count / 1024.0)
    return "%.1f MB" % (count / (1024 * 1024.0))


def fmt_size_detail(size_bytes, image_count):
    if image_count:
        return "(%s, %d image%s)" % (
            fmt_bytes(size_bytes),
            image_count,
            "" if image_count == 1 else "s",
        )
    return "(%s)" % fmt_bytes(size_bytes)


# --------------------------------------------------------------------------
# local validation, mirroring the server


def normalize_document_path(raw):
    """Return the canonical absolute document path, or raise CliError."""
    if not isinstance(raw, str) or not raw.strip():
        raise CliError("a document path is required")

    decoded = urllib.parse.unquote(raw)
    if CONTROL_CHAR_RE.search(decoded):
        raise CliError("the document path contains a control character: %r" % raw)

    normalized = decoded.strip().replace("\\", "/")
    if WINDOWS_DRIVE_RE.match(normalized):
        raise CliError("Windows drive paths are not allowed: %s" % raw)

    normalized = re.sub(r"^(?:\./)+", "", normalized)
    if not normalized.startswith("/"):
        normalized = "/" + normalized
    normalized = re.sub(r"/+", "/", normalized)

    if len(normalized) > MAX_PATH_LENGTH:
        raise CliError("the document path is longer than %d characters" % MAX_PATH_LENGTH)
    if normalized != "/" and normalized.endswith("/"):
        normalized = normalized[:-1]

    segments = [segment for segment in normalized.split("/") if segment]
    if not segments or any(segment in (".", "..") for segment in segments):
        raise CliError("the document path contains an unsafe segment: %s" % raw)
    if len(segments) > MAX_PATH_DEPTH:
        raise CliError("the document path cannot be nested more than %d levels deep" % MAX_PATH_DEPTH)

    extension = os.path.splitext(segments[-1])[1].lower()
    if extension not in DOCUMENT_EXTENSIONS:
        raise CliError(
            "only .md, .markdown, .html, and .htm document paths are supported: %s" % raw,
            hint="a path must name a file, for example /product/research.md",
        )

    return normalized


def normalize_asset_path(raw):
    """Mirror normalizeAssetPath(): decode, drop query/fragment, reject unsafe."""
    decoded = urllib.parse.unquote(raw)
    path = decoded.split("#", 1)[0].split("?", 1)[0]
    path = path.replace("\\", "/")
    path = re.sub(r"^\./", "", path)
    path = re.sub(r"/+", "/", path)

    if not path:
        raise CliError("empty image reference")
    if path.startswith("/"):
        raise CliError(
            "absolute image path: %s" % raw,
            hint="the server rejects absolute asset paths; the image must be a local file uploaded with the document",
        )
    if WINDOWS_DRIVE_RE.match(path):
        raise CliError("Windows drive image path: %s" % raw)
    if any(segment == ".." for segment in path.split("/")):
        raise CliError("image path escapes the document directory: %s" % raw)
    if "\0" in path:
        raise CliError("image path contains a NUL byte")

    return path


def clean_destination(raw):
    """Mirror the server: trim, then strip angle brackets and quotes."""
    destination = re.sub(r"^<|>$", "", raw.strip())
    return re.sub(r"^[\"']|[\"']$", "", destination)


def parse_duration(text):
    """Parse 7d / 12h / 90m / 1d12h into seconds."""
    match = DURATION_RE.match(text.strip().lower())
    if not match or not any(match.groups()):
        raise CliError(
            "invalid duration: %s" % text,
            hint="use a duration such as 7d, 36h, 90m, or 1d12h",
        )
    days, hours, minutes, seconds = (int(value or 0) for value in match.groups())
    total = ((days * 24 + hours) * 60 + minutes) * 60 + seconds
    if total < MIN_SHARE_TTL_SECONDS or total > MAX_SHARE_TTL_SECONDS:
        raise CliError(
            "the expiry must be between 60 seconds and 90 days, got %s" % text,
            hint="for a link that never expires pass --never, and say so when reporting it",
        )
    return total


def parse_instant(text):
    candidate = text.strip()
    if candidate.endswith(("Z", "z")):
        candidate = candidate[:-1] + "+00:00"
    try:
        moment = datetime.datetime.fromisoformat(candidate)
    except ValueError:
        raise CliError(
            "invalid ISO 8601 deadline: %s" % text,
            hint="for example 2026-10-09T09:00:00Z",
        )
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=datetime.timezone.utc)

    now = datetime.datetime.now(datetime.timezone.utc)
    if moment <= now:
        raise CliError("the expiry must be in the future: %s" % text)
    if moment - now > datetime.timedelta(seconds=MAX_SHARE_TTL_SECONDS):
        raise CliError("the expiry cannot be more than 90 days from now: %s" % text)
    return text


def normalize_title(raw):
    title = raw.strip()
    if not title:
        raise CliError("a document title cannot be empty")
    if len(title) > MAX_TITLE_LENGTH:
        raise CliError("the title is longer than %d characters" % MAX_TITLE_LENGTH)
    return title


def check_limit(value):
    if value is None:
        return None
    if value < 1 or value > MAX_LIST_LIMIT:
        raise CliError("--limit must be an integer between 1 and %d" % MAX_LIST_LIMIT)
    return value


def check_query(value):
    if value is None:
        return None
    query = value.strip()
    if len(query) > MAX_QUERY_LENGTH:
        raise CliError("the search query is longer than %d characters" % MAX_QUERY_LENGTH)
    return query or None


# --------------------------------------------------------------------------
# HTTP


class Api:
    def __init__(self, base_url, token, timeout, debug=False):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout
        self.debug = debug

    def request(self, method, path, query=None, body=None, content_type=None, hint=None):
        url = self.base_url + path
        if query:
            clean = {key: value for key, value in query.items() if value is not None}
            if clean:
                url += "?" + urllib.parse.urlencode(clean)

        headers = {
            "Authorization": "Bearer " + self.token,
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        }
        if content_type:
            headers["Content-Type"] = content_type

        if self.debug:
            err("> %s %s (%d bytes)" % (method, url, len(body) if body else 0))

        request = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                status = response.getcode()
                payload = response.read()
        except urllib.error.HTTPError as exc:
            status = exc.code
            payload = exc.read()
        except urllib.error.URLError as exc:
            raise CliError(
                "cannot reach %s: %s" % (self.base_url, exc.reason),
                code=EXIT_SERVER,
                hint="check AGENTBOARD_URL, network access, and that the server is running",
            )
        except (TimeoutError, OSError) as exc:
            raise CliError(
                "request to %s failed: %s" % (self.base_url, exc),
                code=EXIT_SERVER,
                hint="retry once; do not repeat a create blindly, run `search` first",
            )

        if self.debug:
            err("< %s %s" % (status, url))

        if not 200 <= status < 300:
            raise ApiError(status, read_error_message(payload, status), hint=hint or default_hint(status, self.base_url))

        return payload

    def json_request(self, *args, **kwargs):
        return read_json(self.request(*args, **kwargs))


def read_error_message(payload, status):
    try:
        decoded = json.loads(payload.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        decoded = None
    if isinstance(decoded, dict) and isinstance(decoded.get("error"), str):
        return decoded["error"]
    return "HTTP %d" % status


def read_json(payload):
    try:
        return json.loads(payload.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise CliError("the server returned a response that is not JSON", code=EXIT_SERVER)


def build_multipart(fields, files):
    boundary = "----agentboard-" + uuid.uuid4().hex
    chunks = []
    for name, value in fields:
        chunks.append(
            (
                '--%s\r\nContent-Disposition: form-data; name="%s"\r\n\r\n%s\r\n'
                % (boundary, name, value)
            ).encode("utf-8")
        )
    for name, filename, mime_type, data in files:
        safe_name = (
            filename.replace("\\", "_")
            .replace('"', "%22")
            .replace("\r", "")
            .replace("\n", "")
        )
        head = (
            '--%s\r\nContent-Disposition: form-data; name="%s"; filename="%s"\r\n'
            "Content-Type: %s\r\n\r\n" % (boundary, name, safe_name, mime_type)
        )
        chunks.append(head.encode("utf-8") + data + b"\r\n")
    chunks.append(("--%s--\r\n" % boundary).encode("utf-8"))
    return b"".join(chunks), "multipart/form-data; boundary=" + boundary


# --------------------------------------------------------------------------
# uploads

def document_format(filename):
    extension = os.path.splitext(filename)[1].lower()
    if extension in (".md", ".markdown"):
        return "markdown"
    if extension in (".html", ".htm"):
        return "html"
    raise CliError(
        "only .md, .markdown, .html, and .htm documents are supported: %s" % filename,
        hint="rename the file or pass --path with a supported extension",
    )


def find_local_file(reference, document_dir, cwd):
    for base in (document_dir, cwd):
        candidate = os.path.join(base, *reference.split("/"))
        if os.path.isfile(candidate):
            return candidate
    return None


def iter_image_destinations(source, source_format):
    """Yield every image reference the server would try to rewrite.

    MD_IMAGE_RE captures the destination in group 2 (group 1 is the `![alt](`
    prefix and group 3 is the trailing text); HTML_IMAGE_RE captures the src
    value in group 3 (group 2 is the opening quote).
    """
    if source_format == "markdown":
        for match in MD_IMAGE_RE.finditer(source):
            yield match.group(2)
    for match in HTML_IMAGE_RE.finditer(source):
        yield match.group(3)


def local_image_references(source, source_format):
    """Every non-remote image reference, as written in the document."""
    return [
        destination
        for destination in (
            clean_destination(raw) for raw in iter_image_destinations(source, source_format)
        )
        if destination and not REMOTE_URL_RE.match(destination)
    ]


def collect_assets(source, source_format, document_dir, cwd):
    """Return [(normalized_path, file_path, mime, size)] plus warnings."""
    entries = []
    seen = set()
    missing = []

    for raw in iter_image_destinations(source, source_format):
        destination = clean_destination(raw)
        if not destination or REMOTE_URL_RE.match(destination):
            continue
        if UNSAFE_SCHEME_RE.match(destination):
            raise CliError(
                "unsafe image reference: %s" % destination,
                hint="data:, javascript:, vbscript:, and file: image URLs are rejected by the server",
            )

        try:
            normalized = normalize_asset_path(destination)
        except CliError as exc:
            raise CliError("cannot upload image reference %r: %s" % (destination, exc.message), hint=exc.hint)

        if normalized in seen:
            continue
        seen.add(normalized)

        local_path = find_local_file(normalized, document_dir, cwd)
        if not local_path:
            missing.append(normalized)
            continue

        mime_type = IMAGE_MIME_TYPES.get(os.path.splitext(normalized)[1].lower())
        if not mime_type:
            raise CliError(
                "unsupported image type: %s" % normalized,
                hint="use PNG, JPEG, GIF, or WebP images",
            )

        size = os.path.getsize(local_path)
        if size > MAX_ASSET_BYTES:
            raise CliError(
                "image is larger than 4 MiB: %s (%s)" % (normalized, fmt_bytes(size))
            )

        entries.append((normalized, local_path, mime_type, size))

    if missing:
        raise CliError(
            "cannot find local image%s: %s" % ("" if len(missing) == 1 else "s", ", ".join(missing)),
            hint="looked in %s and %s; add the files or fix the references"
            % (document_dir, cwd),
        )

    warnings = []
    if MD_REF_IMAGE_RE.search(source):
        warnings.append("the server does not rewrite reference-style Markdown images, so those images will not render")
    if SRCSET_RE.search(source):
        warnings.append("the server does not rewrite srcset attributes")

    return entries, warnings


def build_upload_payload(args, source_format, document_dir, cwd):
    """Return (fields, files, assets, warnings) for a create or replace."""
    with open(args.file, "rb") as handle:
        document_bytes = handle.read()

    if len(document_bytes) > MAX_DOCUMENT_BYTES:
        raise CliError(
            "the document is larger than 4 MiB (%s)" % fmt_bytes(len(document_bytes)),
            hint="split the document or reduce its embedded content",
        )

    try:
        source = document_bytes.decode("utf-8")
    except UnicodeDecodeError:
        raise CliError("the document must be UTF-8 text: %s" % args.file)

    assets = []
    warnings = []
    if args.no_assets:
        # Fail fast instead of sending a document the server will reject for an
        # unresolved image, and instead of storing one with a broken image.
        orphans = sorted(set(local_image_references(source, source_format)))
        if orphans:
            raise CliError(
                "--no-assets was given but the document references local images: %s"
                % ", ".join(orphans),
                hint="drop --no-assets so the images are uploaded, or remove the references",
            )
    else:
        assets, warnings = collect_assets(source, source_format, document_dir, cwd)

    if len(assets) > MAX_ASSET_COUNT:
        raise CliError(
            "a document can contain at most %d uploaded images, got %d"
            % (MAX_ASSET_COUNT, len(assets))
        )

    total_bytes = len(document_bytes) + sum(asset[3] for asset in assets)
    if total_bytes > MAX_BUNDLE_BYTES:
        raise CliError(
            "the document bundle is larger than 5 MiB (%s)" % fmt_bytes(total_bytes),
            hint="reduce the document or its images",
        )

    upload_name = os.path.basename(args.path) if args.path else os.path.basename(args.file)
    document_mime = "text/html" if source_format == "html" else "text/markdown"

    fields = []
    if args.title is not None:
        fields.append(("title", normalize_title(args.title)))
    if args.path is not None:
        fields.append(("path", normalize_document_path(args.path)))

    manifest = [
        {"field": "asset_%d" % index, "path": entry[0]}
        for index, entry in enumerate(assets)
    ]
    if manifest:
        fields.append(("manifest", json.dumps(manifest)))

    files = [("document", upload_name, document_mime, document_bytes)]
    for index, entry in enumerate(assets):
        with open(entry[1], "rb") as handle:
            files.append(("asset_%d" % index, os.path.basename(entry[0]), entry[2], handle.read()))

    return fields, files, assets, warnings


def report_asset_warnings(warnings):
    for warning in warnings:
        err("warning: %s" % warning)


# --------------------------------------------------------------------------
# target resolution


def resolve_target(api, target):
    """Return (document_id, summary_or_None) for an id or a /path."""
    candidate = target.strip()
    if UUID_RE.match(candidate):
        return candidate, None

    path = normalize_document_path(candidate)
    filename = path.rsplit("/", 1)[-1]
    cursor = None

    for _ in range(RESOLVE_MAX_PAGES):
        payload = api.json_request(
            "GET",
            "/api/v1/documents",
            query={"q": filename, "limit": RESOLVE_PAGE_LIMIT, "cursor": cursor},
        )
        for document in payload.get("documents", []):
            if document.get("path") == path:
                return document["id"], document
        cursor = payload.get("nextCursor")
        if not cursor:
            break

    parent = path.rsplit("/", 1)[0] or "/"
    raise CliError(
        "no document at path %s" % path,
        code=EXIT_NOT_FOUND,
        hint="run `tree %s` to see what is there, or `search %s`" % (parent, filename),
    )


# --------------------------------------------------------------------------
# commands


def cmd_list(args):
    api = make_api(args)
    query = check_query(getattr(args, "query", None))
    limit = check_limit(args.limit if args.limit is not None else DEFAULT_LIST_LIMIT)
    payload = api.json_request(
        "GET",
        "/api/v1/documents",
        query={"q": query, "limit": limit, "cursor": args.cursor},
    )

    if args.json:
        print_json(payload)
        return EXIT_OK

    documents = payload.get("documents", [])
    if not documents:
        out("no documents%s" % (" matching %r" % query if query else ""))
    else:
        print_table(
            ["ID", "PATH", "TITLE", "UPDATED"],
            [
                [
                    document.get("id", ""),
                    document.get("path", ""),
                    document.get("title", ""),
                    fmt_time(document.get("updatedAt")),
                ]
                for document in documents
            ],
        )
    if payload.get("nextCursor"):
        out("more: %s" % payload["nextCursor"])
    return EXIT_OK


def cmd_tree(args):
    api = make_api(args)
    limit = check_limit(args.limit if args.limit is not None else DEFAULT_LIST_LIMIT)
    payload = api.json_request(
        "GET",
        "/api/v1/documents/tree",
        query={"parent": args.path, "limit": limit, "cursor": args.cursor},
    )

    if args.json:
        print_json(payload)
        return EXIT_OK

    entries = payload.get("entries", [])
    if not entries:
        out("empty %s" % payload.get("parentPath", args.path))
    else:
        rows = []
        for entry in entries:
            if entry.get("kind") == "directory":
                rows.append([entry.get("path", "") + "/", "", ""])
            else:
                rows.append(
                    [entry.get("path", ""), entry.get("id", ""), entry.get("title", "")]
                )
        print_table(["PATH", "ID", "TITLE"], rows)
    if payload.get("nextCursor"):
        out("more: %s" % payload["nextCursor"])
    return EXIT_OK


def cmd_get(args):
    api = make_api(args)
    if args.meta and args.out:
        raise CliError("--out cannot be combined with --meta", hint="drop --meta, or drop --out and read the metadata from stdout")
    if args.json and (args.html or args.meta or args.out):
        raise CliError(
            "--json cannot be combined with --html, --meta, or --out",
            hint="--json already prints the whole document, including the source and the preview",
        )
    document_id, _summary = resolve_target(api, args.target)
    payload = api.json_request("GET", "/api/v1/documents/" + urllib.parse.quote(document_id))
    document = payload.get("document", payload)

    if args.json:
        print_json(payload)
        return EXIT_OK

    if args.meta:
        print_meta(document, api.base_url)
        return EXIT_OK

    content = document.get("sanitizedHtml", "") if args.html else document.get("sourceContent", "")
    if args.out:
        write_file(args.out, content)
        out("wrote %s (%s)" % (args.out, fmt_bytes(len(content.encode("utf-8")))))
    else:
        out_raw(content)
    return EXIT_OK


def print_meta(document, base_url):
    out("id       %s" % document.get("id", ""))
    out("path     %s" % document.get("path", ""))
    out("url      %s/documents/%s" % (base_url, document.get("id", "")))
    out("title    %s" % document.get("title", ""))
    out("format   %s" % document.get("sourceFormat", ""))
    out("bytes    %s" % document.get("sourceBytes", ""))
    out("created  %s" % fmt_time(document.get("createdAt")))
    out("updated  %s" % fmt_time(document.get("updatedAt")))
    out("hash     %s" % document.get("contentHash", ""))
    assets = document.get("assets", []) or []
    out("assets   %d" % len(assets))
    for asset in assets:
        out(
            "  %s  %s  %s"
            % (asset.get("sourcePath", ""), fmt_bytes(asset.get("sizeBytes", 0)), asset.get("publicUrl", ""))
        )


def write_file(path, content):
    try:
        with open(path, "w", encoding="utf-8", newline="") as handle:
            handle.write(content)
    except OSError as exc:
        raise CliError("cannot write %s: %s" % (path, exc))


def cmd_create(args):
    api = make_api(args)
    ensure_readable_file(args.file)
    source_format = document_format(os.path.basename(args.path) if args.path else args.file)
    fields, files, assets, warnings = build_upload_payload(
        args, source_format, os.path.dirname(os.path.abspath(args.file)), os.getcwd()
    )
    report_asset_warnings(warnings)

    body, content_type = build_multipart(fields, files)
    payload = api.json_request(
        "POST",
        "/api/v1/documents",
        body=body,
        content_type=content_type,
    )

    if args.json:
        print_json(payload)
        return EXIT_OK

    document = payload.get("document", {})
    out(
        "created %s  %s  %s"
        % (
            document.get("path", ""),
            document.get("id", ""),
            fmt_size_detail(document.get("sourceBytes", 0), len(assets)),
        )
    )
    out("open    %s/documents/%s" % (api.base_url, document.get("id", "")))
    return EXIT_OK


def cmd_update(args):
    api = make_api(args)
    ensure_readable_file(args.file)
    document_id, summary = resolve_target(api, args.target)

    if args.title is None:
        # Replacement without a title makes the server derive one from the new
        # filename; keeping the current title is the least surprising default.
        if summary is not None:
            args.title = summary.get("title")
        else:
            current = api.json_request(
                "GET", "/api/v1/documents/" + urllib.parse.quote(document_id)
            )
            args.title = current.get("document", {}).get("title")

    source_format = document_format(os.path.basename(args.path) if args.path else args.file)
    fields, files, assets, warnings = build_upload_payload(
        args, source_format, os.path.dirname(os.path.abspath(args.file)), os.getcwd()
    )
    report_asset_warnings(warnings)

    body, content_type = build_multipart(fields, files)
    payload = api.json_request(
        "PUT",
        "/api/v1/documents/" + urllib.parse.quote(document_id),
        body=body,
        content_type=content_type,
    )

    if args.json:
        print_json(payload)
        return EXIT_OK

    document = payload.get("document", {})
    out(
        "replaced %s  %s  %s"
        % (
            document.get("path", ""),
            document.get("id", ""),
            fmt_size_detail(document.get("sourceBytes", 0), len(assets)),
        )
    )
    out("open    %s/documents/%s" % (api.base_url, document.get("id", "")))
    return EXIT_OK


def cmd_move(args):
    api = make_api(args)
    if args.path is None and args.title is None:
        raise CliError("pass --path, --title, or both")

    document_id, summary = resolve_target(api, args.target)
    body = {}
    if args.path is not None:
        body["path"] = normalize_document_path(args.path)
    if args.title is not None:
        body["title"] = normalize_title(args.title)

    payload = api.json_request(
        "PATCH",
        "/api/v1/documents/" + urllib.parse.quote(document_id),
        body=json.dumps(body).encode("utf-8"),
        content_type="application/json",
    )

    if args.json:
        print_json(payload)
        return EXIT_OK

    document = payload.get("document", {})
    previous_path = (summary or {}).get("path")
    if args.path is not None and previous_path and previous_path != document.get("path"):
        out("moved %s -> %s  %s" % (previous_path, document.get("path", ""), document.get("id", "")))
    else:
        out("updated %s  %s  %s" % (document.get("path", ""), document.get("title", ""), document.get("id", "")))
    out("open    %s/documents/%s" % (api.base_url, document.get("id", "")))
    return EXIT_OK


def cmd_delete(args):
    api = make_api(args)
    if not args.yes:
        raise CliError(
            "refusing to delete without --yes",
            hint="re-run the same command with --yes once the delete is confirmed",
        )

    document_id, summary = resolve_target(api, args.target)
    payload = api.json_request(
        "DELETE", "/api/v1/documents/" + urllib.parse.quote(document_id)
    )

    if args.json:
        print_json(payload)
        return EXIT_OK

    if summary is not None:
        out("deleted %s  %s" % (summary.get("path", ""), document_id))
    else:
        out("deleted %s" % document_id)
    return EXIT_OK


def cmd_share_create(args):
    api = make_api(args)
    document_id, _summary = resolve_target(api, args.target)

    body = {}
    if args.name is not None:
        name = args.name.strip()
        if not name:
            raise CliError("--name cannot be empty")
        if len(name) > MAX_SHARE_NAME_LENGTH:
            raise CliError("--name is longer than %d characters" % MAX_SHARE_NAME_LENGTH)
        body["name"] = name

    if args.never:
        body["neverExpires"] = True
        ttl_label = "never"
    elif args.expires_at is not None:
        body["expiresAt"] = parse_instant(args.expires_at)
        ttl_label = None
    else:
        seconds = parse_duration(args.expires_in) if args.expires_in else DEFAULT_SHARE_TTL_SECONDS
        body["expiresInSeconds"] = seconds
        ttl_label = args.expires_in or "7d"

    payload = api.json_request(
        "POST",
        "/api/v1/documents/%s/shares" % urllib.parse.quote(document_id),
        body=json.dumps(body).encode("utf-8"),
        content_type="application/json",
    )

    if args.json:
        print_json(payload)
        return EXIT_OK

    share = payload.get("share", {})
    out("url      %s" % payload.get("url", ""))
    out("share    %s" % share.get("id", ""))
    if share.get("expiresAt"):
        label = " (%s)" % ttl_label if ttl_label else ""
        out("expires  %s UTC%s" % (fmt_time(share["expiresAt"]), label))
    else:
        out("expires  never")
    if share.get("name"):
        out("name     %s" % share["name"])

    if args.never:
        err("note: this link never expires; revoke it with `share revoke %s %s` when it is no longer needed" % (document_id, share.get("id", "")))
    return EXIT_OK


def cmd_share_list(args):
    api = make_api(args)
    document_id, _summary = resolve_target(api, args.target)
    payload = api.json_request(
        "GET", "/api/v1/documents/%s/shares" % urllib.parse.quote(document_id)
    )

    if args.json:
        print_json(payload)
        return EXIT_OK

    shares = payload.get("shares", [])
    if not shares:
        out("no share links")
        return EXIT_OK

    print_table(
        ["ID", "STATUS", "EXPIRES", "VIEWS", "NAME"],
        [
            [
                share.get("id", ""),
                share.get("status", ""),
                fmt_time(share.get("expiresAt")) or "never",
                str(share.get("viewCount", 0)),
                share.get("name") or "",
            ]
            for share in shares
        ],
    )
    return EXIT_OK


def cmd_share_revoke(args):
    api = make_api(args)
    document_id, _summary = resolve_target(api, args.target)
    payload = api.json_request(
        "DELETE",
        "/api/v1/documents/%s/shares/%s"
        % (urllib.parse.quote(document_id), urllib.parse.quote(args.share_id)),
    )

    if args.json:
        print_json(payload)
        return EXIT_OK

    out("revoked %s" % args.share_id)
    return EXIT_OK


def cmd_share_purge(args):
    api = make_api(args)
    document_id, _summary = resolve_target(api, args.target)
    payload = api.json_request(
        "DELETE",
        "/api/v1/documents/%s/shares/%s"
        % (urllib.parse.quote(document_id), urllib.parse.quote(args.share_id)),
        query={"purge": "true"},
        hint="the link is still active; revoke it with `share revoke` first",
    )

    if args.json:
        print_json(payload)
        return EXIT_OK

    out("purged %s" % args.share_id)
    return EXIT_OK


# --------------------------------------------------------------------------
# config


def cmd_config_set(args):
    config, _path = load_config()

    url = config.get("url")
    if args.url is not None:
        url, problem = normalize_base_url(args.url)
        if problem:
            raise CliError("--url is not usable: %s" % problem)

    token = config.get("token")
    if args.token_stdin:
        token = sys.stdin.read().strip()
        if not token:
            raise CliError("no token arrived on stdin", hint="pipe the key in, for example `pbpaste | agentboard.py config set --token-stdin`")
        if "\n" in token:
            raise CliError("the token must be a single line")
    elif os.environ.get("AGENTBOARD_TOKEN", "").strip():
        token = os.environ["AGENTBOARD_TOKEN"].strip()

    if not url and not token:
        raise CliError(
            "nothing to store",
            hint="pass --url, pass --token-stdin, or set AGENTBOARD_TOKEN before running this command",
        )

    stored = {}
    if url:
        stored["url"] = url
    if token:
        stored["token"] = token

    path = save_config(stored)
    out("wrote    %s" % path)
    if url:
        out("url      %s" % url)
    out("token    %s" % (mask_token(token) if token else "(not stored; set AGENTBOARD_TOKEN per call)"))
    if not token:
        err("note: without a stored token every command still needs AGENTBOARD_TOKEN in its environment")
    return EXIT_OK


def cmd_config_show(args):
    config, path = load_config()
    if path:
        exists = "" if os.path.isfile(path) else "  (no file yet)"
        out("path     %s%s" % (path, exists))
    else:
        out("path     (unavailable: no home directory)")

    out("url      %s" % (config.get("url") or "(not stored)"))
    if config.get("token"):
        out("token    %s (stored, %d characters)" % (mask_token(config["token"]), len(config["token"])))
    else:
        out("token    (not stored)")

    if os.environ.get("AGENTBOARD_URL", "").strip():
        out("env      AGENTBOARD_URL is set and overrides the stored url")
    if os.environ.get("AGENTBOARD_TOKEN", "").strip():
        out("env      AGENTBOARD_TOKEN is set and overrides the stored token")
    return EXIT_OK


def cmd_config_path(args):
    path = config_path()
    if not path:
        raise CliError(
            "no config path is available because no home directory is set",
            code=EXIT_CONFIG,
            hint="set AGENTBOARD_CONFIG to choose the file explicitly",
        )
    out(path)
    return EXIT_OK


def cmd_config_clear(args):
    path = config_path()
    if not path:
        raise CliError(
            "no config path is available because no home directory is set",
            code=EXIT_CONFIG,
            hint="set AGENTBOARD_CONFIG to choose the file explicitly",
        )
    if not args.yes:
        raise CliError(
            "refusing to remove the stored credentials without --yes",
            hint="the API token cannot be shown again by Agentboard, so keep a copy before clearing it",
        )
    if not os.path.isfile(path):
        out("no config file at %s" % path)
        return EXIT_OK
    try:
        os.remove(path)
    except OSError as exc:
        raise CliError("cannot remove %s: %s" % (path, exc), code=EXIT_CONFIG)

    out("removed %s" % path)
    return EXIT_OK


# --------------------------------------------------------------------------
# plumbing


def ensure_readable_file(path):
    if path == "-":
        raise CliError(
            "reading the document from stdin is not supported",
            hint="write the content to a file and pass its path",
        )
    if os.path.isdir(path):
        raise CliError("%s is a directory, not a document" % path)
    if not os.path.isfile(path):
        raise CliError("document not found: %s" % path)


def config_path():
    """Where the stored credentials live, or None when no home directory exists.

    `AGENTBOARD_CONFIG` wins so tests and sandboxes can redirect the file, then
    `XDG_CONFIG_HOME`, then `~/.config`.
    """
    override = os.environ.get(CONFIG_ENV_VAR, "").strip()
    if override:
        return os.path.abspath(os.path.expanduser(override))

    home = os.path.expanduser("~")
    if not home or home == "~":
        return None

    xdg_home = os.environ.get("XDG_CONFIG_HOME", "").strip()
    base = os.path.expanduser(xdg_home) if xdg_home else os.path.join(home, ".config")
    return os.path.join(base, CONFIG_DIR_NAME, CONFIG_FILE_NAME)


def warn_if_world_readable(path):
    try:
        mode = os.stat(path).st_mode
    except OSError:
        return
    if mode & 0o077:
        err("warning: %s is readable by other users; run `chmod 600 %s`" % (path, path))


def load_config():
    """Return (config, path), with the file's url/token when it exists."""
    path = config_path()
    if not path or not os.path.isfile(path):
        return {}, path

    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError) as exc:
        raise CliError(
            "cannot read the Agentboard config at %s: %s" % (path, exc),
            code=EXIT_CONFIG,
            hint="fix or delete that file, or set AGENTBOARD_URL and AGENTBOARD_TOKEN for this call",
        )

    if not isinstance(data, dict):
        raise CliError(
            "the Agentboard config at %s is not a JSON object" % path,
            code=EXIT_CONFIG,
            hint='it should look like {"url": "https://...", "token": "ab_..."}',
        )

    config = {}
    for key in ("url", "token"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            config[key] = value.strip()

    warn_if_world_readable(path)
    return config, path


def save_config(config):
    path = config_path()
    if not path:
        raise CliError(
            "cannot determine a config path because no home directory is set",
            code=EXIT_CONFIG,
            hint="set AGENTBOARD_CONFIG to the file that should hold the credentials",
        )

    directory = os.path.dirname(path)
    temporary = "%s.tmp-%d" % (path, os.getpid())
    try:
        os.makedirs(directory, mode=0o700, exist_ok=True)
        # Created 0600 and moved into place, so the token is never briefly
        # world-readable and a failed write cannot truncate a good file.
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(config, handle, indent=2, sort_keys=True)
            handle.write("\n")
        os.replace(temporary, path)
    except OSError as exc:
        if os.path.exists(temporary):
            try:
                os.remove(temporary)
            except OSError:
                pass
        raise CliError(
            "cannot write %s: %s" % (path, exc),
            code=EXIT_CONFIG,
            hint="check that the directory is writable, or point AGENTBOARD_CONFIG at a writable file",
        )

    return path


def mask_token(token):
    if len(token) <= 8:
        return "*" * len(token)
    return "%s…%s" % (token[:6], token[-4:])


def normalize_base_url(raw):
    """Return (url, problem): a canonical base URL, or None plus why it is unusable.

    Shared by `config set` and `config login` so the accepted form cannot drift.
    """
    candidate = raw.strip().rstrip("/")
    if not candidate:
        return None, "a base URL is required"
    if "://" not in candidate:
        candidate = "https://" + candidate

    parsed = urllib.parse.urlsplit(candidate)
    if parsed.scheme not in ("http", "https"):
        return None, "the base URL must start with http:// or https://"
    if not parsed.netloc:
        return None, "the base URL needs a host, for example https://agentboard.example.com"
    if parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        return None, (
            "the base URL must be an origin without a path, "
            "for example https://agentboard.example.com"
        )
    return candidate, None


def prompt_line(prompt):
    """Write a prompt to stderr and read one line from stdin."""
    sys.stderr.write(prompt)
    sys.stderr.flush()
    line = sys.stdin.readline()
    if line == "":
        raise CliError("cancelled: no input", hint="the credentials were not stored")
    return line.strip()


def prompt_hidden(prompt):
    """Read a secret without echoing it. Ctrl-D cancels; Ctrl-C stays a 130 exit."""
    try:
        return getpass.getpass(prompt, stream=sys.stderr).strip()
    except EOFError:
        raise CliError("cancelled: no input", hint="the credentials were not stored")


def cmd_config_login(args):
    if not sys.stdin.isatty():
        raise CliError(
            "config login needs an interactive terminal",
            hint="for scripts, agents, and CI use `config set`: pipe the key with --token-stdin, or set AGENTBOARD_TOKEN",
        )

    config, path = load_config()
    if path:
        err("storing credentials in %s" % path)

    if args.url is not None:
        url, problem = normalize_base_url(args.url)
        if problem:
            raise CliError("--url is not usable: %s" % problem)
    else:
        default = config.get("url") or os.environ.get("AGENTBOARD_URL", "").strip()
        suffix = " [%s]" % default if default else ""
        url = None
        for _ in range(LOGIN_PROMPT_ATTEMPTS):
            answer = prompt_line("Agentboard base URL%s: " % suffix)
            if not answer:
                answer = default
            url, problem = normalize_base_url(answer)
            if url:
                break
            err("error: %s" % problem)
        if not url:
            raise CliError("no usable base URL was entered", hint="the credentials were not stored")

    token = None
    for _ in range(LOGIN_PROMPT_ATTEMPTS):
        answer = prompt_hidden("API token (hidden): ")
        if not answer:
            err("error: a token is required")
            continue
        token = answer
        break
    if not token:
        raise CliError("no token was entered", hint="the credentials were not stored")

    if not token.startswith("ab_"):
        err("warning: Agentboard keys normally start with ab_")

    api = Api(url, token, args.timeout, args.debug)
    verification_failed = False
    if args.no_verify:
        verification = "verify   skipped (--no-verify)"
    else:
        try:
            api.json_request("GET", "/api/v1/documents", query={"limit": 1})
        except ApiError as exc:
            if exc.status in (401, 403):
                # Never replace a working config with credentials the server rejects.
                raise CliError(
                    "the server rejected those credentials: %s" % exc.message,
                    code=EXIT_AUTH,
                    hint="nothing was stored; check the key at %s/settings and run `config login` again"
                    % url,
                )
            err("warning: could not verify the credentials: %s" % exc.message)
            verification_failed = True
            verification = "verify   not verified; the credentials were stored anyway"
        except CliError as exc:
            err("warning: could not verify the credentials: %s" % exc.message)
            verification_failed = True
            verification = "verify   not verified; the credentials were stored anyway"
        else:
            verification = (
                "verify   read access confirmed; write access is checked on the first upload"
            )

    stored_path = save_config({"url": url, "token": token})
    out("wrote    %s" % stored_path)
    out("url      %s" % url)
    out("token    %s" % mask_token(token))
    out(verification)
    return EXIT_SERVER if verification_failed else EXIT_OK


def make_api(args):
    env_url = os.environ.get("AGENTBOARD_URL", "").strip()
    env_token = os.environ.get("AGENTBOARD_TOKEN", "").strip()

    # The file is only read when a value is actually needed from it, so a
    # fully-specified environment keeps working even with an unreadable file.
    config = {}
    if not ((args.url or env_url) and env_token):
        config, _path = load_config()

    base_url = (args.url or env_url or config.get("url", "")).strip()
    token = (env_token or config.get("token", "")).strip()

    if not base_url:
        raise CliError(
            "no Agentboard URL configured",
            code=EXIT_CONFIG,
            hint="run `agentboard.py config set --url https://your-agentboard-host`, or export AGENTBOARD_URL for one call",
        )
    if not token:
        raise CliError(
            "no Agentboard API token configured",
            code=EXIT_CONFIG,
            hint="run `agentboard.py config set --token-stdin`, or export AGENTBOARD_TOKEN for one call (create a key at %s/settings)"
            % base_url.rstrip("/"),
        )
    if "://" not in base_url:
        base_url = "https://" + base_url

    return Api(base_url, token, args.timeout, args.debug)


def apply_defaults(args):
    defaults = {
        "json": False,
        "url": None,
        "timeout": 60.0,
        "debug": False,
        "limit": None,
        "cursor": None,
        "out": None,
        "title": None,
        "path": None,
        "no_assets": False,
        "meta": False,
        "html": False,
        "yes": False,
        "query": None,
        "token_stdin": False,
        "no_verify": False,
    }
    for key, value in defaults.items():
        if not hasattr(args, key):
            setattr(args, key, value)


def add_common_options(parser):
    parser.add_argument(
        "--json",
        action="store_true",
        default=argparse.SUPPRESS,
        help="print the raw server JSON payload instead of the compact output",
    )
    parser.add_argument(
        "--url",
        default=argparse.SUPPRESS,
        help="base URL for this call (default: $AGENTBOARD_URL)",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=argparse.SUPPRESS,
        help="request timeout in seconds (default: 60)",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        default=argparse.SUPPRESS,
        help="log the request method, URL, and status to stderr",
    )


def add_paging_options(parser):
    parser.add_argument(
        "--limit",
        type=int,
        default=argparse.SUPPRESS,
        help="page size, 1-100 (default: 50)",
    )
    parser.add_argument(
        "--cursor",
        default=argparse.SUPPRESS,
        help="continue from a `more:` cursor printed by a previous call",
    )


EXAMPLES_LIST = """examples:
  agentboard.py list
  agentboard.py list --limit 100
  agentboard.py search "research notes" --limit 10
"""

EXAMPLES_TREE = """examples:
  agentboard.py tree
  agentboard.py tree /product
"""

EXAMPLES_GET = """examples:
  agentboard.py get /product/research.md
  agentboard.py get 0f1d2c3b-... --meta
  agentboard.py get /product/research.md --html --out preview.html
"""

EXAMPLES_CREATE = """examples:
  agentboard.py tree /product
  agentboard.py create notes/research.md --path /product/research.md --title "Research notes"
  agentboard.py create report.html --path /product/report.html
"""

EXAMPLES_UPDATE = """examples:
  agentboard.py update /product/research.md notes/research-v2.md
  agentboard.py update 0f1d2c3b-... notes/research-v2.md --path /product/research/current.md
"""

EXAMPLES_MOVE = """examples:
  agentboard.py move /product/research.md --path /product/archive/research.md
  agentboard.py move /product/research.md --title "Current research"
"""

EXAMPLES_DELETE = """examples:
  agentboard.py delete /product/drafts/old.md --yes
"""

EXAMPLES_SHARE_CREATE = """examples:
  agentboard.py share create /product/research.md --name "Client preview"
  agentboard.py share create /product/research.md --expires-in 36h
  agentboard.py share create /product/research.md --never --name "Permanent reference"
"""

EXAMPLES_SHARE_LIST = """examples:
  agentboard.py share list /product/research.md
"""

EXAMPLES_SHARE_REVOKE = """examples:
  agentboard.py share revoke /product/research.md 0f1d2c3b-...
"""

EXAMPLES_SHARE_PURGE = """examples:
  agentboard.py share purge /product/research.md 0f1d2c3b-...
"""

EXAMPLES_CONFIG_SET = """examples:
  agentboard.py config set --url https://agentboard.example.com --token-stdin
  printf '%s' "$AGENTBOARD_TOKEN" | agentboard.py config set --token-stdin
  agentboard.py config set --url https://agentboard.example.com
"""

EXAMPLES_CONFIG_LOGIN = """examples:
  agentboard.py config login
  agentboard.py config login --url https://agentboard.example.com
  agentboard.py config login --no-verify
"""

EXAMPLES_CONFIG_SHOW = """examples:
  agentboard.py config show
"""

EXAMPLES_CONFIG_PATH = """examples:
  agentboard.py config path
"""

EXAMPLES_CONFIG_CLEAR = """examples:
  agentboard.py config clear --yes
"""


def build_parser():
    epilog = """configuration:
  Store once, then every command works without environment variables:
    agentboard.py config login    # interactive: prompt for the URL, then the hidden key
    agentboard.py config set --url https://agentboard.example.com --token-stdin
    agentboard.py config show     # path, stored URL, masked token
  `login` needs a TTY and verifies the credentials before storing them; `set` is the
  scripted path for agents, CI, and pipes. The file is $AGENTBOARD_CONFIG, else
  $XDG_CONFIG_HOME/agentboard/config.json, else ~/.config/agentboard/config.json,
  and it is written mode 0600.

  AGENTBOARD_URL / AGENTBOARD_TOKEN override the stored values for one call, so
  CI, sandboxes, and alternate hosts keep working. A token is only ever sent as
  `Authorization: Bearer <token>`, is never passed as an argument, and is never
  printed; `config show` masks it.

targets:
  TARGET is a document id or a /path as printed by tree, list, or search.
  A path is resolved with one search request, so prefer paths in agent output.

workflow:
  1. tree /                 see the library and the naming style of siblings
  2. search "topic"         check the document does not already exist
  3. create notes.md --path /product/research.md --title "Research notes"
  4. get /product/research.md                read the source back
     update /product/research.md v2.md       replace content, keeping path and title
  5. share create /product/research.md --expires-in 7d --name "Client preview"

  create, update, and move print `open <baseUrl>/documents/<id>`: report that link,
  with the document path and title, to whoever asked for the change. The dashboard
  link needs a signed-in account and the API URL needs a bearer key, so for anyone
  outside the account create a share link instead and report its URL and expiry.

limits (server-enforced; checked locally where possible):
  document     .md .markdown .html .htm, max 4 MiB
  images       PNG/JPEG/GIF/WebP, max 4 MiB each, max 50 per document, bundle max 5 MiB
  path         absolute and globally unique, max 500 characters, max 64 levels
  title        max 160 characters; share name max 80 characters
  share        60 seconds to 90 days; --never is permanent until revoked
  list         --limit 1-100 (default 50); search query max 200 characters

images:
  create and update read the document, find local image references, and upload the
  matching files (resolved relative to the document, then to the current directory).
  Remote http(s) images are left alone. A missing local image stops the upload and
  lists the paths that were tried. Use --no-assets only for a document that
  references no local images.

shares:
  A share link makes the document readable by anyone with the URL. Create one only
  when asked, prefer the shortest expiry, report the URL immediately because it is
  shown once and cannot be retrieved again, and revoke it when it is no longer needed.

exit codes:
  0 ok  2 usage or input error  3 no URL or token configured
  4 auth (401/403)  5 not found (404)  6 conflict (409)  7 invalid (422)
  8 network or server error
"""

    parser = argparse.ArgumentParser(
        prog="agentboard.py",
        description=(
            "Read and write Agentboard documents from the command line.\n"
            "Start with `tree` to find a destination, and `search` before creating."
        ),
        epilog=epilog,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="command", metavar="<command>", required=True)

    # list ------------------------------------------------------------------
    parser_list = subparsers.add_parser(
        "list",
        help="list or search documents",
        description="List document summaries, newest first, or search titles and paths.",
        epilog=EXAMPLES_LIST,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser_list.add_argument("--query", "-q", help="substring to match in titles and paths")
    add_paging_options(parser_list)
    add_common_options(parser_list)
    parser_list.set_defaults(func=cmd_list)

    # search ----------------------------------------------------------------
    parser_search = subparsers.add_parser(
        "search",
        help="search documents by title or path",
        description="Search document titles and paths. Same output as `list`.",
        epilog=EXAMPLES_LIST,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser_search.add_argument("query", metavar="QUERY", help="substring to match in titles and paths")
    add_paging_options(parser_search)
    add_common_options(parser_search)
    parser_search.set_defaults(func=cmd_list)

    # tree ------------------------------------------------------------------
    parser_tree = subparsers.add_parser(
        "tree",
        help="list the direct children of one folder",
        description=(
            "List the direct children of one folder, folders first in path order.\n"
            "Read this before creating a document so the path matches its siblings."
        ),
        epilog=EXAMPLES_TREE,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser_tree.add_argument("path", metavar="PATH", nargs="?", default="/", help="folder path (default: /)")
    add_paging_options(parser_tree)
    add_common_options(parser_tree)
    parser_tree.set_defaults(func=cmd_tree)

    # get -------------------------------------------------------------------
    parser_get = subparsers.add_parser(
        "get",
        help="read one document",
        description=(
            "Read one document. The default prints the stored source, verbatim.\n"
            "--html prints the sanitized preview instead, --meta prints metadata."
        ),
        epilog=EXAMPLES_GET,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser_get.add_argument("target", metavar="TARGET", help="document id or /path")
    view = parser_get.add_mutually_exclusive_group()
    view.add_argument("--html", action="store_true", help="print sanitizedHtml instead of the source")
    view.add_argument("--meta", action="store_true", help="print metadata and asset records instead of content")
    parser_get.add_argument("--out", metavar="FILE", help="write the content to FILE instead of stdout")
    add_common_options(parser_get)
    parser_get.set_defaults(func=cmd_get)

    # create ----------------------------------------------------------------
    parser_create = subparsers.add_parser(
        "create",
        help="create a document from a local file",
        description=(
            "Create a document from a local Markdown or HTML file.\n"
            "Local images referenced by the document are uploaded automatically.\n"
            "The upload filename follows --path when it is given."
        ),
        epilog=EXAMPLES_CREATE,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser_create.add_argument("file", metavar="FILE", help="local .md, .markdown, .html, or .htm file")
    parser_create.add_argument("--path", metavar="PATH", help="destination path, for example /product/research.md (default: /<filename>)")
    parser_create.add_argument("--title", metavar="TITLE", help="display title (default: derived from the filename)")
    parser_create.add_argument("--no-assets", action="store_true", help="do not upload images; fails if the document references local images")
    add_common_options(parser_create)
    parser_create.set_defaults(func=cmd_create)

    # update ----------------------------------------------------------------
    parser_update = subparsers.add_parser(
        "update",
        help="replace a document's content, keeping its id",
        description=(
            "Replace a document's content with a new file, keeping the document id.\n"
            "The path and title are kept unless --path or --title is given."
        ),
        epilog=EXAMPLES_UPDATE,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser_update.add_argument("target", metavar="TARGET", help="document id or /path")
    parser_update.add_argument("file", metavar="FILE", help="replacement .md, .markdown, .html, or .htm file")
    parser_update.add_argument("--path", metavar="PATH", help="move to this path while replacing (default: keep the current path)")
    parser_update.add_argument("--title", metavar="TITLE", help="new title (default: keep the current title)")
    parser_update.add_argument("--no-assets", action="store_true", help="do not upload images; fails if the document references local images")
    add_common_options(parser_update)
    parser_update.set_defaults(func=cmd_update)

    # move ------------------------------------------------------------------
    parser_move = subparsers.add_parser(
        "move",
        help="move or retitle a document without replacing content",
        description="Move a document in the tree, retitle it, or both. The id and content do not change.",
        epilog=EXAMPLES_MOVE,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser_move.add_argument("target", metavar="TARGET", help="document id or /path")
    parser_move.add_argument("--path", metavar="PATH", help="new path")
    parser_move.add_argument("--title", metavar="TITLE", help="new display title")
    add_common_options(parser_move)
    parser_move.set_defaults(func=cmd_move)

    # delete ----------------------------------------------------------------
    parser_delete = subparsers.add_parser(
        "delete",
        help="delete a document and its images",
        description=(
            "Delete a document and its images. Requires --yes.\n"
            "Delete only when the user explicitly asked for it."
        ),
        epilog=EXAMPLES_DELETE,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser_delete.add_argument("target", metavar="TARGET", help="document id or /path")
    parser_delete.add_argument("--yes", action="store_true", help="confirm the deletion (required)")
    add_common_options(parser_delete)
    parser_delete.set_defaults(func=cmd_delete)

    # share -----------------------------------------------------------------
    parser_share = subparsers.add_parser(
        "share",
        help="create, list, revoke, or purge public links",
        description=(
            "Manage a document's public links.\n"
            "A link is the only way to publish a document's reading view; treat it as public."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    share_subparsers = parser_share.add_subparsers(
        dest="share_command", metavar="<share-command>", required=True
    )

    parser_share_create = share_subparsers.add_parser(
        "create",
        help="create a public link and print its URL once",
        description=(
            "Create a public link. The URL is returned once and can never be listed again,\n"
            "so capture it and hand it to the user immediately.\n"
            "Pass one expiry form; without a flag the link lasts 7 days."
        ),
        epilog=EXAMPLES_SHARE_CREATE,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser_share_create.add_argument("target", metavar="TARGET", help="document id or /path")
    parser_share_create.add_argument("--name", metavar="NAME", help="dashboard label, max 80 characters (never shown to viewers)")
    expiry = parser_share_create.add_mutually_exclusive_group()
    expiry.add_argument("--expires-in", metavar="DURATION", help="lifetime such as 7d, 36h, or 90m (60s-90d; default: 7d)")
    expiry.add_argument("--expires-at", metavar="ISO8601", help="exact deadline, for example 2026-10-09T09:00:00Z")
    expiry.add_argument("--never", action="store_true", help="create a link that never expires until revoked")
    add_common_options(parser_share_create)
    parser_share_create.set_defaults(func=cmd_share_create)

    parser_share_list = share_subparsers.add_parser(
        "list",
        help="list a document's links",
        description="List a document's links with status, expiry, view count, and name. Token material is never returned.",
        epilog=EXAMPLES_SHARE_LIST,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser_share_list.add_argument("target", metavar="TARGET", help="document id or /path")
    add_common_options(parser_share_list)
    parser_share_list.set_defaults(func=cmd_share_list)

    parser_share_revoke = share_subparsers.add_parser(
        "revoke",
        help="stop a link from working",
        description=(
            "Revoke a link immediately, keeping its record for the audit trail.\n"
            "Revoking an already revoked link succeeds, so a retry is safe."
        ),
        epilog=EXAMPLES_SHARE_REVOKE,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser_share_revoke.add_argument("target", metavar="TARGET", help="document id or /path")
    parser_share_revoke.add_argument("share_id", metavar="SHARE_ID", help="share id from `share list`")
    add_common_options(parser_share_revoke)
    parser_share_revoke.set_defaults(func=cmd_share_revoke)

    parser_share_purge = share_subparsers.add_parser(
        "purge",
        help="delete the record of a link that already stopped working",
        description=(
            "Delete a link's record. Only allowed once the link is expired or revoked;\n"
            "prefer `share revoke`, which keeps the history the user may ask about."
        ),
        epilog=EXAMPLES_SHARE_PURGE,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser_share_purge.add_argument("target", metavar="TARGET", help="document id or /path")
    parser_share_purge.add_argument("share_id", metavar="SHARE_ID", help="share id from `share list`")
    add_common_options(parser_share_purge)
    parser_share_purge.set_defaults(func=cmd_share_purge)

    # config ----------------------------------------------------------------
    parser_config = subparsers.add_parser(
        "config",
        help="store or inspect the base URL and API token",
        description=(
            "Manage the stored credentials so ordinary commands need no environment\n"
            "variables. `login` prompts a human at a terminal; `set` is the scripted\n"
            "path for agents and CI. An environment variable still overrides the\n"
            "stored value for one call."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    config_subparsers = parser_config.add_subparsers(
        dest="config_command", metavar="<config-command>", required=True
    )

    parser_config_login = config_subparsers.add_parser(
        "login",
        help="prompt for the URL and API token interactively",
        description=(
            "Prompt for the base URL, then for the API token with echo off, verify them\n"
            "against the server, and store them. Built for a person at a terminal: it\n"
            "needs a TTY, so scripts, agents, and CI should use `config set` instead.\n"
            "Credentials the server rejects are never stored over a working config."
        ),
        epilog=EXAMPLES_CONFIG_LOGIN,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser_config_login.add_argument("--url", metavar="URL", help="skip the URL prompt and use this URL")
    parser_config_login.add_argument(
        "--no-verify",
        action="store_true",
        help="store without checking the credentials against the server",
    )
    parser_config_login.add_argument(
        "--timeout",
        type=float,
        default=argparse.SUPPRESS,
        help="verification request timeout in seconds (default: 60)",
    )
    parser_config_login.add_argument(
        "--debug",
        action="store_true",
        default=argparse.SUPPRESS,
        help="log the verification request to stderr",
    )
    parser_config_login.set_defaults(func=cmd_config_login)

    parser_config_set = config_subparsers.add_parser(
        "set",
        help="store the base URL and API token",
        description=(
            "Store the base URL, the API token, or both in the config file.\n"
            "The token is never accepted as an argument, because arguments leak into\n"
            "shell history and process listings: pipe it in with --token-stdin, or set\n"
            "AGENTBOARD_TOKEN for this one command."
        ),
        epilog=EXAMPLES_CONFIG_SET,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser_config_set.add_argument("--url", metavar="URL", help="Agentboard base URL to store")
    parser_config_set.add_argument(
        "--token-stdin",
        action="store_true",
        help="read the API token from stdin instead of AGENTBOARD_TOKEN",
    )
    parser_config_set.set_defaults(func=cmd_config_set)

    parser_config_show = config_subparsers.add_parser(
        "show",
        help="print the stored URL, a masked token, and the file path",
        description=(
            "Print where the credentials live, the stored URL, and the stored token\n"
            "masked. It never prints the token and never contacts the server."
        ),
        epilog=EXAMPLES_CONFIG_SHOW,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser_config_show.set_defaults(func=cmd_config_show)

    parser_config_path = config_subparsers.add_parser(
        "path",
        help="print the config file path",
        description="Print the config file path, which AGENTBOARD_CONFIG overrides.",
        epilog=EXAMPLES_CONFIG_PATH,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser_config_path.set_defaults(func=cmd_config_path)

    parser_config_clear = config_subparsers.add_parser(
        "clear",
        help="delete the stored credentials",
        description=(
            "Delete the config file. Requires --yes, because Agentboard shows an API\n"
            "token only once and a deleted file may be the only copy."
        ),
        epilog=EXAMPLES_CONFIG_CLEAR,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser_config_clear.add_argument("--yes", action="store_true", help="confirm the deletion (required)")
    parser_config_clear.set_defaults(func=cmd_config_clear)

    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    apply_defaults(args)

    try:
        return args.func(args)
    except CliError as exc:
        err("error: %s" % exc.message)
        if exc.hint:
            err("hint: %s" % exc.hint)
        return exc.code
    except KeyboardInterrupt:
        err("error: interrupted")
        return 130
    except BrokenPipeError:
        try:
            sys.stdout.close()
        except OSError:
            pass
        return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
