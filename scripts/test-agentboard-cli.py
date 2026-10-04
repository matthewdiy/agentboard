#!/usr/bin/env python3
"""Tests for skills/agentboard/scripts/agentboard.py.

Runs the CLI as a subprocess against an in-process stub of the Agentboard API,
so the assertions cover the real interface: stdout, stderr, and exit codes.
No network access and no AGENTBOARD_URL in the caller's environment.

    python3 scripts/test-agentboard-cli.py
"""

import email
import email.policy
import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.parse
from contextlib import redirect_stderr, redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock

# Importing the CLI under test must not leave __pycache__ inside the skill.
sys.dont_write_bytecode = True

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLI = os.path.join(REPO_ROOT, "skills", "agentboard", "scripts", "agentboard.py")

TOKEN = "ab_testtoken"
READONLY_TOKEN = "ab_readonly"
PLAIN_TOKEN = "legacy_token_without_prefix"
NOW = "2026-10-02T09:00:00.000Z"
SUMMARY_KEYS = (
    "id",
    "path",
    "title",
    "sourceFormat",
    "sourceFilename",
    "contentHash",
    "sourceBytes",
    "createdAt",
    "updatedAt",
)

DOC_ID = "11111111-1111-4111-8111-111111111111"
OTHER_ID = "22222222-2222-4222-8222-222222222222"


def make_document(doc_id, path, title, source="Body text.", source_format="markdown"):
    return {
        "id": doc_id,
        "path": path,
        "title": title,
        "sourceFormat": source_format,
        "sourceFilename": path.rsplit("/", 1)[-1],
        "contentHash": "sha256:0000000000000000",
        "sourceBytes": len(source.encode("utf-8")),
        "createdAt": NOW,
        "updatedAt": NOW,
        "sourceContent": source,
        "sanitizedHtml": "<p>%s</p>" % source,
        "assets": [],
    }


def summary_of(document):
    return {key: document[key] for key in SUMMARY_KEYS}


def parse_multipart(content_type, body):
    raw = (
        b"Content-Type: " + content_type.encode("utf-8") + b"\r\nMIME-Version: 1.0\r\n\r\n" + body
    )
    message = email.parser.BytesParser(policy=email.policy.default).parsebytes(raw)
    fields = {}
    files = {}
    for part in message.iter_parts():
        name = part.get_param("name", header="content-disposition")
        filename = part.get_filename()
        payload = part.get_payload(decode=True)
        if filename is None:
            fields[name] = (payload or b"").decode("utf-8")
        else:
            files[name] = {"filename": filename, "data": payload or b""}
    return fields, files


class State:
    def __init__(self):
        self.documents = {}
        self.shares = {}
        self.requests = []
        self.last_upload = None
        self.next_share = 1


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):  # keep the test output clean
        pass

    def do_GET(self):
        self.handle_request("GET")

    def do_POST(self):
        self.handle_request("POST")

    def do_PUT(self):
        self.handle_request("PUT")

    def do_PATCH(self):
        self.handle_request("PATCH")

    def do_DELETE(self):
        self.handle_request("DELETE")

    # -- helpers ----------------------------------------------------------

    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def fail(self, status, message):
        self.send_json(status, {"error": message})

    def handle_request(self, method):
        state = self.server.state
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = {key: values[0] for key, values in urllib.parse.parse_qs(parsed.query).items()}
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""

        state.requests.append({"method": method, "path": path, "query": query, "body": body})

        header = self.headers.get("Authorization", "")
        token = header[7:] if header.lower().startswith("bearer ") else None
        if token not in (TOKEN, READONLY_TOKEN, PLAIN_TOKEN):
            return self.fail(401, "Invalid or deleted bearer token.")
        if token == READONLY_TOKEN and method != "GET":
            return self.fail(403, "Token does not have the required scope.")

        segments = [segment for segment in path.split("/") if segment]
        if segments[:3] != ["api", "v1", "documents"]:
            return self.fail(404, "Unknown route.")

        rest = segments[3:]

        if not rest:
            if method == "GET":
                return self.list_documents(query)
            if method == "POST":
                return self.create_document()
            return self.fail(405, "Method not allowed.")

        if rest == ["tree"] and method == "GET":
            return self.tree(query)

        document_id = rest[0]
        if len(rest) == 1:
            if method == "GET":
                return self.read_document(document_id)
            if method == "PUT":
                return self.replace_document(document_id)
            if method == "PATCH":
                return self.update_document(document_id)
            if method == "DELETE":
                return self.delete_document(document_id)
            return self.fail(405, "Method not allowed.")

        if rest[1] == "shares":
            if len(rest) == 2:
                if method == "GET":
                    return self.list_shares(document_id)
                if method == "POST":
                    return self.create_share(document_id)
                return self.fail(405, "Method not allowed.")
            if len(rest) == 3 and method == "DELETE":
                return self.delete_share(document_id, rest[2], query)
        return self.fail(404, "Unknown route.")

    # -- documents --------------------------------------------------------

    def list_documents(self, query):
        state = self.server.state
        documents = sorted(state.documents.values(), key=lambda doc: doc["path"])
        needle = (query.get("q") or "").lower()
        if needle:
            documents = [
                doc
                for doc in documents
                if needle in doc["title"].lower() or needle in doc["path"].lower()
            ]
        limit = int(query.get("limit") or 50)
        documents = documents[:limit]
        self.send_json(200, {"documents": [summary_of(doc) for doc in documents], "nextCursor": None})

    def tree(self, query):
        state = self.server.state
        parent = query.get("parent") or "/"
        prefix = "/" if parent == "/" else parent.rstrip("/") + "/"
        entries = []
        seen_directories = set()
        for document in sorted(state.documents.values(), key=lambda doc: doc["path"]):
            path = document["path"]
            if not path.startswith(prefix):
                continue
            remainder = path[len(prefix) :]
            if "/" in remainder:
                directory = prefix + remainder.split("/", 1)[0]
                if directory not in seen_directories:
                    seen_directories.add(directory)
                    entries.append(
                        {
                            "kind": "directory",
                            "path": directory,
                            "parentPath": parent,
                            "name": directory.rsplit("/", 1)[-1],
                        }
                    )
            elif prefix != "/" or path != prefix:
                entries.append({"kind": "file", **summary_of(document)})
        entries.sort(key=lambda entry: entry["path"])
        self.send_json(200, {"parentPath": parent, "entries": entries, "nextCursor": None})

    def read_document(self, document_id):
        document = self.server.state.documents.get(document_id)
        if not document:
            return self.fail(404, "Document not found.")
        self.send_json(200, {"document": document})

    def create_document(self):
        state = self.server.state
        fields, files = parse_multipart(self.headers.get("Content-Type", ""), state.requests[-1]["body"])
        state.last_upload = {"fields": fields, "files": files}
        if "document" not in files:
            return self.fail(422, "A document file is required.")

        upload = files["document"]
        path = fields.get("path") or "/" + upload["filename"]
        if path in {doc["path"] for doc in state.documents.values()}:
            return self.fail(409, "That path is already taken.")

        title = fields.get("title")
        if title and "REJECT" in title:
            return self.fail(422, "The title is invalid.")
        if not title:
            title = upload["filename"].rsplit(".", 1)[0]

        document_id = "33333333-3333-4333-8333-%012d" % len(state.documents)
        document = make_document(
            document_id,
            path,
            title,
            upload["data"].decode("utf-8"),
            "html" if upload["filename"].endswith((".html", ".htm")) else "markdown",
        )
        manifest = json.loads(fields.get("manifest") or "[]")
        for entry in manifest:
            document["assets"].append(
                {
                    "id": "asset-" + entry["field"],
                    "sourcePath": entry["path"],
                    "publicUrl": "https://agentboard.example/assets/" + entry["field"],
                    "mimeType": "image/png",
                    "sizeBytes": len(files[entry["field"]]["data"]),
                }
            )
        state.documents[document_id] = document
        self.send_json(201, {"document": document})

    def replace_document(self, document_id):
        state = self.server.state
        if document_id not in state.documents:
            return self.fail(404, "Document not found.")
        fields, files = parse_multipart(self.headers.get("Content-Type", ""), state.requests[-1]["body"])
        state.last_upload = {"fields": fields, "files": files}

        document = dict(state.documents[document_id])
        if "path" in fields:
            if fields["path"] in {
                doc["path"] for key, doc in state.documents.items() if key != document_id
            }:
                return self.fail(409, "That path is already taken.")
            document["path"] = fields["path"]
        if "title" in fields:
            document["title"] = fields["title"]
        document["sourceContent"] = files["document"]["data"].decode("utf-8")
        document["sourceBytes"] = len(files["document"]["data"])
        state.documents[document_id] = document
        self.send_json(200, {"document": document})

    def update_document(self, document_id):
        state = self.server.state
        document = state.documents.get(document_id)
        if not document:
            return self.fail(404, "Document not found.")
        changes = json.loads(state.requests[-1]["body"] or b"{}")
        updated = dict(document)
        if "path" in changes:
            if changes["path"] in {
                doc["path"] for key, doc in state.documents.items() if key != document_id
            }:
                return self.fail(409, "That path is already taken.")
            updated["path"] = changes["path"]
        if "title" in changes:
            updated["title"] = changes["title"]
        state.documents[document_id] = updated
        self.send_json(200, {"document": updated})

    def delete_document(self, document_id):
        state = self.server.state
        if document_id not in state.documents:
            return self.fail(404, "Document not found.")
        del state.documents[document_id]
        self.send_json(200, {"deleted": True})

    # -- shares -----------------------------------------------------------

    def create_share(self, document_id):
        state = self.server.state
        if document_id not in state.documents:
            return self.fail(404, "Document not found.")
        body = json.loads(state.requests[-1]["body"] or b"{}")
        forms = [key for key in ("expiresInSeconds", "expiresAt", "neverExpires") if key in body]
        if len(forms) != 1:
            return self.fail(422, "A share link expiry or neverExpires flag is required.")

        share_id = "share-%d" % state.next_share
        state.next_share += 1
        share = {
            "id": share_id,
            "name": body.get("name"),
            "expiresAt": None if forms[0] == "neverExpires" else "2026-10-09T09:00:00.000Z",
            "createdAt": NOW,
            "revokedAt": None,
            "lastAccessedAt": None,
            "viewCount": 0,
            "status": "active",
        }
        state.shares[(document_id, share_id)] = share
        self.send_json(
            201,
            {
                "share": share,
                "token": "tok_" + share_id,
                "url": self.server.base_url + "/s/tok_" + share_id,
            },
        )

    def list_shares(self, document_id):
        state = self.server.state
        if document_id not in state.documents:
            return self.fail(404, "Document not found.")
        shares = [share for (doc, _), share in state.shares.items() if doc == document_id]
        self.send_json(200, {"shares": shares})

    def delete_share(self, document_id, share_id, query):
        state = self.server.state
        share = state.shares.get((document_id, share_id))
        if not share:
            return self.fail(404, "Share link not found.")
        if query.get("purge") == "true":
            if share["status"] == "active":
                return self.fail(409, "Revoke the link before removing it.")
            del state.shares[(document_id, share_id)]
            self.send_json(200, {"deleted": True})
        share["status"] = "revoked"
        share["revokedAt"] = NOW
        self.send_json(200, {"revoked": True})


class AgentboardTestCase(unittest.TestCase):
    """Shared fixture: a stub API server, a temp workspace, and CLI helpers."""

    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.server.daemon_threads = True
        cls.server.state = State()
        cls.base_url = "http://127.0.0.1:%d" % cls.server.server_address[1]
        cls.server.base_url = cls.base_url
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self.state = self.server.state
        self.state.documents = {}
        self.state.shares = {}
        self.state.requests = []
        self.state.last_upload = None
        self.state.next_share = 1

        self.workspace = tempfile.mkdtemp(prefix="agentboard-cli-test-")
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)

        self.notes = os.path.join(self.workspace, "notes")
        os.makedirs(os.path.join(self.notes, "images"))
        self.write(os.path.join(self.notes, "images", "hero.png"), "hero-bytes")
        self.write(os.path.join(self.notes, "images", "chart.png"), "chart-bytes")
        self.write(os.path.join(self.notes, "research.md"), "# Research\n\nBody text.\n")
        self.write(os.path.join(self.notes, "research-v2.md"), "# Research v2\n\nBody text.\n")

        # Hermetic credentials: point the CLI at a file inside the temp workspace
        # so a developer's real ~/.config/agentboard/config.json is never read.
        self.config_file = os.path.join(self.workspace, "config", "config.json")

    def write(self, path, content):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(content)
        return path

    def write_config(self, content, mode=0o600):
        os.makedirs(os.path.dirname(self.config_file), exist_ok=True)
        with open(self.config_file, "w", encoding="utf-8") as handle:
            handle.write(content)
        os.chmod(self.config_file, mode)
        return self.config_file

    def run_cli(self, *args, token=TOKEN, url=None, stdin=None, config_file=None):
        env = dict(os.environ)
        env.pop("AGENTBOARD_URL", None)
        env.pop("AGENTBOARD_TOKEN", None)
        env["AGENTBOARD_CONFIG"] = config_file or self.config_file
        if url != "":
            env["AGENTBOARD_URL"] = self.base_url if url is None else url
        if token is not None:
            env["AGENTBOARD_TOKEN"] = token
        return subprocess.run(
            [sys.executable, CLI] + list(args),
            capture_output=True,
            text=True,
            input=stdin,
            env=env,
            cwd=self.workspace,
        )

    def seed(self, *documents):
        for document in documents:
            self.state.documents[document["id"]] = document

    def seed_default(self):
        self.seed(
            make_document(
                DOC_ID,
                "/product/research.md",
                "Research notes",
                source="# Research\n\nBody text.\n",
            ),
            make_document(OTHER_ID, "/product/archive/old.md", "Old draft"),
        )

    def recorded(self, method):
        return [request for request in self.state.requests if request["method"] == method]


class CliTestCase(AgentboardTestCase):
    """End-to-end tests that run the CLI as a subprocess."""

    # -- list / search / tree --------------------------------------------

    def test_list_compact_and_json(self):
        self.seed_default()
        result = self.run_cli("list")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("ID", result.stdout.splitlines()[0])
        self.assertIn("/product/research.md", result.stdout)
        self.assertIn("Research notes", result.stdout)
        self.assertIn(DOC_ID, result.stdout)

        result = self.run_cli("list", "--json")
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(len(payload["documents"]), 2)

    def test_search_filters(self):
        self.seed_default()
        result = self.run_cli("search", "old")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("/product/archive/old.md", result.stdout)
        self.assertNotIn("/product/research.md", result.stdout)

    def test_search_no_match(self):
        self.seed_default()
        result = self.run_cli("search", "nothing-here")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("no documents", result.stdout)

    def test_tree_lists_directories_and_files(self):
        self.seed_default()
        result = self.run_cli("tree", "/product")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("/product/archive/", result.stdout)
        self.assertIn("/product/research.md", result.stdout)
        self.assertIn(DOC_ID, result.stdout)

    def test_tree_empty_folder(self):
        self.seed_default()
        result = self.run_cli("tree", "/nothing")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("empty /nothing", result.stdout)

    def test_list_limit_is_validated_locally(self):
        self.seed_default()
        result = self.run_cli("list", "--limit", "500")
        self.assertEqual(result.returncode, 2)
        self.assertIn("--limit must be an integer between 1 and 100", result.stderr)
        self.assertEqual(self.state.requests, [])

    def test_search_query_is_validated_locally(self):
        self.seed_default()
        result = self.run_cli("search", "x" * 201)
        self.assertEqual(result.returncode, 2)
        self.assertIn("longer than 200 characters", result.stderr)
        self.assertEqual(self.state.requests, [])

    def test_paging_cursor_is_passed_through(self):
        self.seed_default()
        result = self.run_cli("list", "--limit", "10", "--cursor", "opaque-cursor")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.state.requests[0]["query"]["cursor"], "opaque-cursor")
        self.assertEqual(self.state.requests[0]["query"]["limit"], "10")

    # -- get ---------------------------------------------------------------

    def test_get_prints_source_verbatim(self):
        self.seed_default()
        result = self.run_cli("get", "/product/research.md")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "# Research\n\nBody text.\n")

    def test_get_html_and_meta(self):
        self.seed_default()
        result = self.run_cli("get", DOC_ID, "--html")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "<p># Research\n\nBody text.\n</p>")

        result = self.run_cli("get", DOC_ID, "--meta")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("path     /product/research.md", result.stdout)
        self.assertIn("url      %s/documents/%s" % (self.base_url, DOC_ID), result.stdout)
        self.assertIn("format   markdown", result.stdout)

    def test_get_out_writes_file(self):
        self.seed_default()
        target = os.path.join(self.workspace, "out.md")
        result = self.run_cli("get", "/product/research.md", "--out", target)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("wrote", result.stdout)
        with open(target, encoding="utf-8") as handle:
            self.assertEqual(handle.read(), "# Research\n\nBody text.\n")

    def test_get_out_writes_the_preview_with_html(self):
        self.seed_default()
        target = os.path.join(self.workspace, "preview.html")
        result = self.run_cli("get", DOC_ID, "--html", "--out", target)
        self.assertEqual(result.returncode, 0, result.stderr)
        with open(target, encoding="utf-8") as handle:
            self.assertEqual(handle.read(), "<p># Research\n\nBody text.\n</p>")

    def test_get_out_to_unwritable_path_exits_usage(self):
        self.seed_default()
        result = self.run_cli("get", DOC_ID, "--out", os.path.join(self.workspace, "nope", "x.md"))
        self.assertEqual(result.returncode, 2)
        self.assertIn("cannot write", result.stderr)

    def test_get_unknown_path_exits_not_found(self):
        self.seed_default()
        result = self.run_cli("get", "/product/missing.md")
        self.assertEqual(result.returncode, 5)
        self.assertIn("no document at path /product/missing.md", result.stderr)
        self.assertIn("hint:", result.stderr)

    def test_get_rejects_unsupported_extension(self):
        result = self.run_cli("get", "/product/notes.txt")
        self.assertEqual(result.returncode, 2)
        self.assertIn("only .md, .markdown, .html, and .htm", result.stderr)

    def test_get_meta_with_out_is_rejected(self):
        self.seed_default()
        result = self.run_cli("get", DOC_ID, "--meta", "--out", "x.md")
        self.assertEqual(result.returncode, 2)
        self.assertIn("--out cannot be combined with --meta", result.stderr)

    def test_get_json_with_view_flags_is_rejected(self):
        self.seed_default()
        result = self.run_cli("get", DOC_ID, "--json", "--html")
        self.assertEqual(result.returncode, 2)
        self.assertIn("--json cannot be combined with", result.stderr)

    def test_get_json_prints_the_raw_document(self):
        self.seed_default()
        result = self.run_cli("get", DOC_ID, "--json")
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["document"]["path"], "/product/research.md")
        self.assertEqual(payload["document"]["sourceContent"], "# Research\n\nBody text.\n")

    # -- create ------------------------------------------------------------

    def create_with_images(self):
        document = self.write(
            os.path.join(self.notes, "with-images.md"),
            "# Images\n\n"
            "![Hero](./images/hero.png)\n"
            "![Chart](images/chart.png?v=2)\n"
            "![Remote](https://example.com/remote.png)\n"
            '<img src="images/hero.png" alt="Hero again">\n',
        )
        return self.run_cli(
            "create",
            document,
            "--path",
            "/product/research.md",
            "--title",
            "Research notes",
        )

    def test_create_uploads_manifest_and_dedupes(self):
        result = self.create_with_images()
        self.assertEqual(result.returncode, 0, result.stderr)

        upload = self.state.last_upload
        manifest = json.loads(upload["fields"]["manifest"])
        self.assertEqual(
            [entry["path"] for entry in manifest], ["images/hero.png", "images/chart.png"]
        )
        self.assertEqual([entry["field"] for entry in manifest], ["asset_0", "asset_1"])
        self.assertEqual(upload["fields"]["path"], "/product/research.md")
        self.assertEqual(upload["fields"]["title"], "Research notes")
        self.assertEqual(upload["files"]["asset_0"]["data"], b"hero-bytes")
        self.assertEqual(upload["files"]["asset_1"]["data"], b"chart-bytes")
        self.assertEqual(upload["files"]["asset_0"]["filename"], "hero.png")

        self.assertTrue(result.stdout.startswith("created /product/research.md  "), result.stdout)
        self.assertIn("2 images", result.stdout)
        self.assertIn("open    %s/documents/" % self.base_url, result.stdout)

    def test_create_accepts_angle_bracket_and_quoted_destinations(self):
        document = self.write(
            os.path.join(self.notes, "variants.md"),
            '![Angle](<images/hero.png>)\n![Quoted]("images/chart.png")\n',
        )
        result = self.run_cli("create", document, "--path", "/product/variants.md")
        self.assertEqual(result.returncode, 0, result.stderr)
        manifest = json.loads(self.state.last_upload["fields"]["manifest"])
        self.assertEqual(
            [entry["path"] for entry in manifest], ["images/hero.png", "images/chart.png"]
        )

    def test_create_scans_html_documents_for_img_tags_only(self):
        document = self.write(
            os.path.join(self.notes, "report.html"),
            "<html><body>\n"
            '<img src="images/chart.png" alt="Chart">\n'
            "![Not rewritten](images/hero.png)\n"
            "</body></html>\n",
        )
        result = self.run_cli("create", document, "--path", "/product/report.html")
        self.assertEqual(result.returncode, 0, result.stderr)
        manifest = json.loads(self.state.last_upload["fields"]["manifest"])
        self.assertEqual([entry["path"] for entry in manifest], ["images/chart.png"])
        self.assertEqual(self.state.last_upload["files"]["document"]["filename"], "report.html")
        self.assertIn("1 image)", result.stdout)

    def test_create_without_path_leaves_path_to_the_server(self):
        self.seed_default()
        document = self.write(os.path.join(self.notes, "plain.md"), "Plain body.\n")
        result = self.run_cli("create", document)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("path", self.state.last_upload["fields"])
        self.assertNotIn("title", self.state.last_upload["fields"])
        self.assertNotIn("manifest", self.state.last_upload["fields"])
        self.assertEqual(self.state.last_upload["files"]["document"]["filename"], "plain.md")

    def test_create_reports_missing_image(self):
        document = self.write(
            os.path.join(self.notes, "broken.md"), "![Missing](images/gone.png)\n"
        )
        result = self.run_cli("create", document, "--path", "/product/broken.md")
        self.assertEqual(result.returncode, 2)
        self.assertIn("cannot find local image: images/gone.png", result.stderr)
        self.assertIn("hint:", result.stderr)
        self.assertEqual(self.recorded("POST"), [])

    def test_create_rejects_absolute_image_reference(self):
        document = self.write(
            os.path.join(self.notes, "absolute.md"), "![Hosted](/assets/abc.png)\n"
        )
        result = self.run_cli("create", document, "--path", "/product/absolute.md")
        self.assertEqual(result.returncode, 2)
        self.assertIn("absolute image path", result.stderr)
        self.assertEqual(self.recorded("POST"), [])

    def test_create_rejects_unsafe_scheme(self):
        document = self.write(
            os.path.join(self.notes, "unsafe.md"), "![Inline](data:image/png;base64,AAAA)\n"
        )
        result = self.run_cli("create", document, "--path", "/product/unsafe.md")
        self.assertEqual(result.returncode, 2)
        self.assertIn("unsafe image reference", result.stderr)

    def test_create_no_assets_with_local_images_fails_before_upload(self):
        self.write(
            os.path.join(self.notes, "local.md"), "![Hero](images/hero.png)\n"
        )
        result = self.run_cli(
            "create", os.path.join(self.notes, "local.md"), "--no-assets", "--path", "/product/local.md"
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("--no-assets was given", result.stderr)
        self.assertEqual(self.recorded("POST"), [])

    def test_create_conflict_exits_conflict(self):
        self.seed_default()
        document = self.write(os.path.join(self.notes, "dup.md"), "Body\n")
        result = self.run_cli("create", document, "--path", "/product/research.md")
        self.assertEqual(result.returncode, 6)
        self.assertIn("already taken", result.stderr)
        self.assertIn("hint:", result.stderr)

    def test_create_422_exits_invalid(self):
        document = self.write(os.path.join(self.notes, "invalid.md"), "Body\n")
        result = self.run_cli(
            "create", document, "--path", "/product/invalid.md", "--title", "REJECT me"
        )
        self.assertEqual(result.returncode, 7)
        self.assertIn("The title is invalid.", result.stderr)

    def test_create_rejects_missing_file(self):
        result = self.run_cli("create", os.path.join(self.notes, "nope.md"))
        self.assertEqual(result.returncode, 2)
        self.assertIn("document not found", result.stderr)

    def test_create_rejects_oversized_document_before_uploading(self):
        document = os.path.join(self.notes, "huge.md")
        with open(document, "wb") as handle:
            handle.write(b"x" * (4 * 1024 * 1024 + 1))
        result = self.run_cli("create", document, "--path", "/product/huge.md")
        self.assertEqual(result.returncode, 2)
        self.assertIn("larger than 4 MiB", result.stderr)
        self.assertEqual(self.recorded("POST"), [])

    def test_create_json_prints_the_raw_payload(self):
        document = self.write(os.path.join(self.notes, "raw.md"), "Body\n")
        result = self.run_cli("create", document, "--path", "/product/raw.md", "--json")
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["document"]["path"], "/product/raw.md")
        self.assertNotIn("created ", result.stdout)

    # -- update / move / delete -------------------------------------------

    def test_update_keeps_title_and_path(self):
        self.seed_default()
        result = self.run_cli(
            "update", "/product/research.md", os.path.join(self.notes, "research-v2.md")
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(result.stdout.startswith("replaced /product/research.md  "), result.stdout)
        self.assertIn("open    %s/documents/%s" % (self.base_url, DOC_ID), result.stdout)

        upload = self.state.last_upload
        self.assertEqual(upload["fields"]["title"], "Research notes")
        self.assertNotIn("path", upload["fields"])
        self.assertEqual(
            upload["files"]["document"]["data"].decode("utf-8"), "# Research v2\n\nBody text.\n"
        )

    def test_update_by_id_fetches_current_title(self):
        self.seed_default()
        result = self.run_cli("update", DOC_ID, os.path.join(self.notes, "research-v2.md"))
        self.assertEqual(result.returncode, 0, result.stderr)
        methods = [request["method"] for request in self.state.requests]
        self.assertEqual(methods[:2], ["GET", "PUT"])
        self.assertEqual(self.state.last_upload["fields"]["title"], "Research notes")

    def test_update_with_explicit_title_and_path(self):
        self.seed_default()
        result = self.run_cli(
            "update",
            "/product/research.md",
            os.path.join(self.notes, "research-v2.md"),
            "--title",
            "Current research",
            "--path",
            "/product/current.md",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.state.last_upload["fields"]["title"], "Current research")
        self.assertEqual(self.state.last_upload["fields"]["path"], "/product/current.md")

    def test_move_reports_the_move(self):
        self.seed_default()
        result = self.run_cli(
            "move", "/product/research.md", "--path", "/product/archive/research.md"
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            result.stdout,
            "moved /product/research.md -> /product/archive/research.md  %s\n"
            "open    %s/documents/%s\n" % (DOC_ID, self.base_url, DOC_ID),
        )
        body = json.loads(self.recorded("PATCH")[0]["body"])
        self.assertEqual(body, {"path": "/product/archive/research.md"})

    def test_move_by_title_alone_reports_the_document(self):
        self.seed_default()
        result = self.run_cli("move", DOC_ID, "--title", "Current research")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("updated /product/research.md  Current research  %s" % DOC_ID, result.stdout)
        self.assertIn("open    %s/documents/%s" % (self.base_url, DOC_ID), result.stdout)

    def test_move_requires_a_change(self):
        self.seed_default()
        result = self.run_cli("move", "/product/research.md")
        self.assertEqual(result.returncode, 2)
        self.assertIn("pass --path, --title, or both", result.stderr)

    def test_delete_requires_yes(self):
        self.seed_default()
        result = self.run_cli("delete", "/product/research.md")
        self.assertEqual(result.returncode, 2)
        self.assertIn("refusing to delete without --yes", result.stderr)
        self.assertEqual(self.recorded("DELETE"), [])

    def test_delete_with_yes(self):
        self.seed_default()
        result = self.run_cli("delete", "/product/research.md", "--yes")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "deleted /product/research.md  %s\n" % DOC_ID)
        self.assertEqual(len(self.recorded("DELETE")), 1)

    # -- shares ------------------------------------------------------------

    def test_share_create_defaults_to_seven_days(self):
        self.seed_default()
        result = self.run_cli("share", "create", "/product/research.md", "--name", "Client preview")
        self.assertEqual(result.returncode, 0, result.stderr)
        body = json.loads(self.recorded("POST")[0]["body"])
        self.assertEqual(body, {"name": "Client preview", "expiresInSeconds": 7 * 24 * 3600})
        self.assertIn("url      %s/s/tok_share-1" % self.base_url, result.stdout)
        self.assertIn("expires  2026-10-09 09:00 UTC (7d)", result.stdout)
        self.assertIn("name     Client preview", result.stdout)

    def test_share_create_duration_forms(self):
        self.seed_default()
        result = self.run_cli("share", "create", DOC_ID, "--expires-in", "1d12h")
        self.assertEqual(result.returncode, 0, result.stderr)
        body = json.loads(self.recorded("POST")[0]["body"])
        self.assertEqual(body["expiresInSeconds"], 36 * 3600)

        result = self.run_cli("share", "create", DOC_ID, "--expires-at", "2026-10-09T09:00:00Z")
        self.assertEqual(result.returncode, 0, result.stderr)
        body = json.loads(self.recorded("POST")[1]["body"])
        self.assertEqual(body["expiresAt"], "2026-10-09T09:00:00Z")

    def test_share_create_never_warns(self):
        self.seed_default()
        result = self.run_cli("share", "create", DOC_ID, "--never")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.recorded("POST")[0]["body"]), {"neverExpires": True})
        self.assertIn("expires  never", result.stdout)
        self.assertIn("note: this link never expires", result.stderr)

    def test_share_create_rejects_conflicting_expiry_flags(self):
        self.seed_default()
        result = self.run_cli("share", "create", DOC_ID, "--never", "--expires-in", "7d")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.recorded("POST"), [])

    def test_share_create_rejects_short_and_long_durations(self):
        self.seed_default()
        result = self.run_cli("share", "create", DOC_ID, "--expires-in", "10s")
        self.assertEqual(result.returncode, 2)
        self.assertIn("between 60 seconds and 90 days", result.stderr)

        result = self.run_cli("share", "create", DOC_ID, "--expires-in", "91d")
        self.assertEqual(result.returncode, 2)

        result = self.run_cli("share", "create", DOC_ID, "--expires-in", "soon")
        self.assertEqual(result.returncode, 2)
        self.assertIn("invalid duration", result.stderr)

    def test_share_create_rejects_long_name(self):
        self.seed_default()
        result = self.run_cli("share", "create", DOC_ID, "--name", "x" * 81)
        self.assertEqual(result.returncode, 2)
        self.assertIn("longer than 80 characters", result.stderr)

    def test_share_list_and_revoke(self):
        self.seed_default()
        self.run_cli("share", "create", DOC_ID, "--never", "--name", "Permanent reference")
        result = self.run_cli("share", "list", "/product/research.md")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("STATUS", result.stdout.splitlines()[0])
        self.assertIn("never", result.stdout)
        self.assertIn("Permanent reference", result.stdout)

        result = self.run_cli("share", "revoke", "/product/research.md", "share-1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "revoked share-1\n")
        self.assertNotIn("purge", self.recorded("DELETE")[-1]["query"])

    def test_share_purge_passes_flag_and_surfaces_conflict(self):
        self.seed_default()
        self.run_cli("share", "create", DOC_ID, "--never")
        result = self.run_cli("share", "purge", DOC_ID, "share-1")
        self.assertEqual(result.returncode, 6)
        self.assertIn("Revoke the link before removing it.", result.stderr)
        self.assertIn("revoke it with `share revoke` first", result.stderr)

        self.run_cli("share", "revoke", DOC_ID, "share-1")
        result = self.run_cli("share", "purge", DOC_ID, "share-1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "purged share-1\n")
        self.assertEqual(self.recorded("DELETE")[-1]["query"].get("purge"), "true")

    # -- config ------------------------------------------------------------

    def test_config_set_stores_and_commands_work_without_env(self):
        self.seed_default()
        result = self.run_cli(
            "config", "set", "--url", self.base_url, "--token-stdin", stdin=TOKEN
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("wrote    %s" % self.config_file, result.stdout)
        self.assertIn("token    ab_tes…oken", result.stdout)

        with open(self.config_file, encoding="utf-8") as handle:
            stored = json.load(handle)
        self.assertEqual(stored, {"url": self.base_url, "token": TOKEN})

        mode = os.stat(self.config_file).st_mode & 0o777
        self.assertEqual(mode, 0o600, oct(mode))
        directory_mode = os.stat(os.path.dirname(self.config_file)).st_mode & 0o777
        self.assertEqual(directory_mode, 0o700, oct(directory_mode))

        # No AGENTBOARD_URL or AGENTBOARD_TOKEN at all: the file alone must work.
        result = self.run_cli("list", token=None, url="")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("/product/research.md", result.stdout)

    def test_env_and_flag_override_the_stored_config(self):
        self.seed_default()
        self.write_config(json.dumps({"url": "https://wrong.example", "token": "ab_wrong"}))

        # The environment beats the file.
        result = self.run_cli("list")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("/product/research.md", result.stdout)

        # The flag beats the environment.
        result = self.run_cli("list", "--url", "https://wrong.example")
        self.assertEqual(result.returncode, 8)
        self.assertIn("cannot reach https://wrong.example", result.stderr)
        self.assertNotIn("scope", result.stderr)

    def test_config_set_reads_the_token_from_the_environment(self):
        result = self.run_cli("config", "set", "--url", self.base_url, token=TOKEN)
        self.assertEqual(result.returncode, 0, result.stderr)
        with open(self.config_file, encoding="utf-8") as handle:
            self.assertEqual(json.load(handle)["token"], TOKEN)

    def test_config_set_keeps_an_existing_token_and_normalises_the_url(self):
        self.write_config(json.dumps({"url": self.base_url, "token": TOKEN}))
        result = self.run_cli("config", "set", "--url", "agentboard.example/", token=None)
        self.assertEqual(result.returncode, 0, result.stderr)
        with open(self.config_file, encoding="utf-8") as handle:
            stored = json.load(handle)
        self.assertEqual(stored, {"url": "https://agentboard.example", "token": TOKEN})

    def test_config_set_can_store_a_url_without_a_token(self):
        result = self.run_cli("config", "set", "--url", self.base_url, token=None)
        self.assertEqual(result.returncode, 0, result.stderr)
        with open(self.config_file, encoding="utf-8") as handle:
            self.assertEqual(json.load(handle), {"url": self.base_url})
        self.assertIn("not stored", result.stdout)
        self.assertIn("note: without a stored token", result.stderr)

    def test_config_set_rejects_an_empty_stdin_token(self):
        result = self.run_cli("config", "set", "--token-stdin", stdin="  \n", token=None)
        self.assertEqual(result.returncode, 2)
        self.assertIn("no token arrived on stdin", result.stderr)
        self.assertFalse(os.path.exists(self.config_file))

    def test_config_show_masks_the_token_and_flags_overrides(self):
        self.write_config(json.dumps({"url": self.base_url, "token": TOKEN}))
        result = self.run_cli("config", "show", token=None, url="")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("path     %s" % self.config_file, result.stdout)
        self.assertIn("url      %s" % self.base_url, result.stdout)
        self.assertIn("ab_tes…oken", result.stdout)
        self.assertNotIn(TOKEN, result.stdout)

        result = self.run_cli("config", "show")
        self.assertIn("AGENTBOARD_URL is set and overrides", result.stdout)
        self.assertIn("AGENTBOARD_TOKEN is set and overrides", result.stdout)

    def test_config_path_respects_the_override(self):
        result = self.run_cli("config", "path", token=None, url="")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), self.config_file)

    def test_config_clear_requires_yes(self):
        self.write_config(json.dumps({"url": self.base_url, "token": TOKEN}))
        result = self.run_cli("config", "clear", token=None, url="")
        self.assertEqual(result.returncode, 2)
        self.assertIn("refusing to remove the stored credentials without --yes", result.stderr)
        self.assertTrue(os.path.exists(self.config_file))

        result = self.run_cli("config", "clear", "--yes", token=None, url="")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "removed %s\n" % self.config_file)
        self.assertFalse(os.path.exists(self.config_file))

        result = self.run_cli("config", "clear", "--yes", token=None, url="")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("no config file at", result.stdout)

    def test_malformed_config_exits_config_with_the_path(self):
        self.write_config('{"url": "https://x"')
        result = self.run_cli("list", token=None)
        self.assertEqual(result.returncode, 3)
        self.assertIn("cannot read the Agentboard config at %s" % self.config_file, result.stderr)

        self.write_config('["not", "an", "object"]')
        result = self.run_cli("list", token=None)
        self.assertEqual(result.returncode, 3)
        self.assertIn("is not a JSON object", result.stderr)

    def test_a_fully_specified_environment_ignores_a_broken_config(self):
        self.seed_default()
        self.write_config('{"url": "https://x"')
        result = self.run_cli("list")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("/product/research.md", result.stdout)

    def test_group_readable_config_warns(self):
        self.write_config(json.dumps({"url": self.base_url, "token": TOKEN}), mode=0o644)
        result = self.run_cli("list", token=None, url="")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("warning: %s is readable by other users" % self.config_file, result.stderr)

    def test_config_commands_need_no_credentials(self):
        for args in (["config", "show"], ["config", "path"]):
            with self.subTest(command=" ".join(args)):
                result = self.run_cli(*args, token=None, url="")
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_config_login_refuses_a_non_tty(self):
        result = self.run_cli("config", "login", token=None, url="", stdin="")
        self.assertEqual(result.returncode, 2)
        self.assertIn("config login needs an interactive terminal", result.stderr)
        self.assertIn("config set", result.stderr)
        self.assertFalse(os.path.exists(self.config_file))

    # -- auth, plumbing ----------------------------------------------------

    def test_missing_config_exits_config(self):
        result = self.run_cli("list", url="")
        self.assertEqual(result.returncode, 3)
        self.assertIn("no Agentboard URL configured", result.stderr)
        self.assertIn("config set --url", result.stderr)

        result = self.run_cli("list", token=None)
        self.assertEqual(result.returncode, 3)
        self.assertIn("no Agentboard API token configured", result.stderr)
        self.assertIn("config set --token-stdin", result.stderr)

    def test_bad_token_exits_auth(self):
        self.seed_default()
        result = self.run_cli("list", token="ab_wrong")
        self.assertEqual(result.returncode, 4)
        self.assertIn("Invalid or deleted bearer token.", result.stderr)
        self.assertIn("config set --token-stdin", result.stderr)

    def test_readonly_token_exits_auth_on_write(self):
        document = self.write(os.path.join(self.notes, "readonly.md"), "Body\n")
        result = self.run_cli(
            "create", document, "--path", "/product/readonly.md", token=READONLY_TOKEN
        )
        self.assertEqual(result.returncode, 4)
        self.assertIn("scope", result.stderr)

    def test_url_without_scheme_gets_https(self):
        self.seed_default()
        result = self.run_cli("list", url="agentboard.example")
        self.assertEqual(result.returncode, 8)
        self.assertIn("cannot reach https://agentboard.example", result.stderr)

    def test_url_override_tolerates_trailing_slash(self):
        self.seed_default()
        result = self.run_cli("list", "--url", self.base_url + "/")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("/product/research.md", result.stdout)

    def test_debug_never_prints_the_token(self):
        self.seed_default()
        result = self.run_cli("list", "--debug")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("> GET", result.stderr)
        self.assertNotIn(TOKEN, result.stdout)
        self.assertNotIn(TOKEN, result.stderr)

    def test_help_for_every_command(self):
        commands = [
            [],
            ["list"],
            ["search"],
            ["tree"],
            ["get"],
            ["create"],
            ["update"],
            ["move"],
            ["delete"],
            ["share"],
            ["share", "create"],
            ["share", "list"],
            ["share", "revoke"],
            ["share", "purge"],
            ["config"],
            ["config", "login"],
            ["config", "set"],
            ["config", "show"],
            ["config", "path"],
            ["config", "clear"],
        ]
        for command in commands:
            with self.subTest(command=command):
                result = self.run_cli(*(command + ["--help"]))
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("usage: agentboard.py", result.stdout)

    def test_unknown_command_exits_usage(self):
        result = self.run_cli("nonsense")
        self.assertEqual(result.returncode, 2)
        self.assertIn("invalid choice", result.stderr)

    def test_json_output_is_valid_for_every_write_command(self):
        cases = [
            (["tree", "/product", "--json"], "entries"),
            (["move", DOC_ID, "--title", "Renamed", "--json"], "document"),
            (
                ["update", DOC_ID, os.path.join(self.notes, "research-v2.md"), "--json"],
                "document",
            ),
            (["share", "create", DOC_ID, "--never", "--json"], "url"),
            (["share", "list", DOC_ID, "--json"], "shares"),
            (["share", "revoke", DOC_ID, "share-1", "--json"], "revoked"),
            (["delete", DOC_ID, "--yes", "--json"], "deleted"),
        ]
        for args, key in cases:
            with self.subTest(command=" ".join(args[:2])):
                self.seed_default()
                result = self.run_cli(*args)
                self.assertEqual(result.returncode, 0, result.stderr)
                payload = json.loads(result.stdout)
                self.assertIn(key, payload)


class ConfigLoginTest(AgentboardTestCase):
    """Drives `config login` in-process, with scripted prompts and a fake TTY.

    A subprocess test cannot reach the interactive path: the command needs a TTY
    and reads the token through getpass, which opens /dev/tty. Patching the three
    prompt entry points exercises the same code the terminal runs.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        spec = importlib.util.spec_from_file_location("agentboard_cli_under_test", CLI)
        cls.cli = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.cli)

    class FakeStdin:
        def __init__(self, answers, isatty=True):
            self.answers = list(answers)
            self._isatty = isatty

        def isatty(self):
            return self._isatty

        def readline(self):
            if not self.answers:
                return ""  # EOF, as Ctrl-D would produce
            return self.answers.pop(0) + "\n"

    def login(self, *argv, url_answers=(), token_answers=(), isatty=True):
        stdin = self.FakeStdin(url_answers, isatty=isatty)
        tokens = list(token_answers)

        def fake_getpass(prompt, stream=None):
            if not tokens:
                raise EOFError()
            return tokens.pop(0)

        stdout, stderr = io.StringIO(), io.StringIO()
        environment = {"AGENTBOARD_CONFIG": self.config_file}
        with mock.patch.object(sys, "stdin", stdin), mock.patch(
            "getpass.getpass", fake_getpass
        ), mock.patch.dict(os.environ, environment, clear=False), redirect_stdout(
            stdout
        ), redirect_stderr(stderr):
            for key in ("AGENTBOARD_URL", "AGENTBOARD_TOKEN"):
                os.environ.pop(key, None)
            code = self.cli.main(["config", "login"] + list(argv))

        return code, stdout.getvalue(), stderr.getvalue()

    def stored_config(self):
        with open(self.config_file, encoding="utf-8") as handle:
            return json.load(handle)

    def test_happy_path_stores_and_verifies(self):
        self.seed_default()
        code, stdout, stderr = self.login(
            url_answers=[self.base_url], token_answers=[TOKEN]
        )
        self.assertEqual(code, 0, stderr)
        self.assertIn("storing credentials in %s" % self.config_file, stderr)
        self.assertIn("wrote    %s" % self.config_file, stdout)
        self.assertIn("url      %s" % self.base_url, stdout)
        self.assertIn("token    ab_tes…oken", stdout)
        self.assertIn("verify   read access confirmed", stdout)
        self.assertEqual(self.stored_config(), {"url": self.base_url, "token": TOKEN})

    def test_existing_url_is_the_prompt_default(self):
        self.seed_default()
        self.write_config(json.dumps({"url": self.base_url, "token": "ab_stale_token"}))
        code, stdout, stderr = self.login(url_answers=[""], token_answers=[TOKEN])
        self.assertEqual(code, 0, stderr)
        self.assertIn("Agentboard base URL [%s]: " % self.base_url, stderr)
        self.assertEqual(self.stored_config(), {"url": self.base_url, "token": TOKEN})

    def test_url_flag_skips_the_url_prompt(self):
        self.seed_default()
        code, stdout, stderr = self.login(
            "--url", self.base_url, token_answers=[TOKEN]
        )
        self.assertEqual(code, 0, stderr)
        self.assertNotIn("Agentboard base URL", stderr)
        self.assertEqual(self.stored_config()["url"], self.base_url)

    def test_url_is_normalised(self):
        self.seed_default()
        code, stdout, stderr = self.login(
            url_answers=[self.base_url + "/"], token_answers=[TOKEN]
        )
        self.assertEqual(code, 0, stderr)
        self.assertEqual(self.stored_config()["url"], self.base_url)

    def test_unusable_urls_are_re_prompted(self):
        self.seed_default()
        code, stdout, stderr = self.login(
            url_answers=["ftp://agentboard.example", "http://127.0.0.1:1/api", self.base_url],
            token_answers=[TOKEN],
        )
        self.assertEqual(code, 0, stderr)
        self.assertIn("must start with http:// or https://", stderr)
        self.assertIn("without a path", stderr)
        self.assertEqual(self.stored_config()["url"], self.base_url)

    def test_three_empty_url_answers_cancel_without_storing(self):
        code, stdout, stderr = self.login(url_answers=["", "", ""])
        self.assertEqual(code, 2)
        self.assertIn("no usable base URL was entered", stderr)
        self.assertFalse(os.path.exists(self.config_file))

    def test_empty_token_answers_cancel_without_storing(self):
        code, stdout, stderr = self.login(
            url_answers=[self.base_url], token_answers=["", "", ""]
        )
        self.assertEqual(code, 2)
        self.assertIn("a token is required", stderr)
        self.assertIn("no token was entered", stderr)
        self.assertFalse(os.path.exists(self.config_file))

    def test_eof_keeps_the_existing_config(self):
        self.write_config(json.dumps({"url": self.base_url, "token": "ab_keep_this"}))
        code, stdout, stderr = self.login()
        self.assertEqual(code, 2)
        self.assertIn("cancelled: no input", stderr)
        self.assertEqual(self.stored_config()["token"], "ab_keep_this")

    def test_rejected_credentials_do_not_clobber_a_working_config(self):
        self.seed_default()
        self.write_config(json.dumps({"url": self.base_url, "token": "ab_keep_this"}))
        code, stdout, stderr = self.login(
            url_answers=[self.base_url], token_answers=["ab_wrong"]
        )
        self.assertEqual(code, 4)
        self.assertIn("the server rejected those credentials", stderr)
        self.assertIn("nothing was stored", stderr)
        self.assertEqual(self.stored_config(), {"url": self.base_url, "token": "ab_keep_this"})

    def test_no_verify_stores_without_contacting_the_server(self):
        code, stdout, stderr = self.login(
            "--url", self.base_url, "--no-verify", token_answers=[TOKEN]
        )
        self.assertEqual(code, 0, stderr)
        self.assertEqual(self.state.requests, [])
        self.assertIn("verify   skipped (--no-verify)", stdout)
        self.assertEqual(self.stored_config(), {"url": self.base_url, "token": TOKEN})

    def test_unreachable_server_stores_with_a_warning(self):
        unreachable = "http://127.0.0.1:1"
        code, stdout, stderr = self.login(
            "--url", unreachable, token_answers=[TOKEN]
        )
        self.assertEqual(code, 8)
        self.assertIn("warning: could not verify the credentials", stderr)
        self.assertIn("not verified; the credentials were stored anyway", stdout)
        self.assertEqual(self.stored_config(), {"url": unreachable, "token": TOKEN})

    def test_key_without_the_ab_prefix_warns_but_stores(self):
        self.seed_default()
        code, stdout, stderr = self.login(
            url_answers=[self.base_url], token_answers=[PLAIN_TOKEN]
        )
        self.assertEqual(code, 0, stderr)
        self.assertIn("warning: Agentboard keys normally start with ab_", stderr)
        self.assertEqual(self.stored_config()["token"], PLAIN_TOKEN)

    def test_non_tty_refusal_inside_the_command(self):
        code, stdout, stderr = self.login(
            url_answers=[self.base_url], token_answers=[TOKEN], isatty=False
        )
        self.assertEqual(code, 2)
        self.assertIn("needs an interactive terminal", stderr)
        self.assertFalse(os.path.exists(self.config_file))


if __name__ == "__main__":
    unittest.main(verbosity=2)
