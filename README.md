# Agentboard

A private document bridge for AI agents. Upload Markdown or HTML documents together with their local images, browse them in a small web library, and read, search, replace, or delete them over a token-authenticated HTTP API.

Document metadata lives in Postgres and image bytes live in Netlify Blobs. Local image references are rewritten to stable public asset URLs at upload time, so a document keeps working after the original files are gone.

## Features

- **Markdown and HTML** — both formats are stored as canonical source, not as a converted copy.
- **Bundled images** — local images travel with the document in one multipart request and each is rewritten to an unguessable `/assets/:id` URL served with immutable cache headers.
- **Sanitized previews** — a reading view rendered from `sanitizedHtml`; scripts, event handlers, embeds, styles, and unsafe URL schemes are stripped from both rendered Markdown and uploaded HTML.
- **Math** — LaTeX in Markdown is converted to self-contained MathML at upload time, so formulas need no stylesheet and inherit the reading typography.
- **Folders without a folder API** — `path=/product/research.md` creates `/product` automatically. A tree endpoint returns one directory at a time for filesystem-style browsing, and folders that empty out are pruned.
- **Search and pagination** — filter documents by title or path with `q`, and page through results with cursors.
- **Scoped API keys** — `documents:read` and `documents:write` bearer keys, created and deleted from the dashboard.
- **Expiring public links** — publish one document at an unguessable `/s/:token` URL, named so links stay tellable apart, with an expiry of up to 90 days or no expiry at all. Only the token's hash is stored, the URL is shown once, and revoking keeps the name, view count, and timestamps as an audit trail while dead links can be removed outright. The public page carries its own light/dark toggle.
- **Restricted access** — Google sign-in limited to an allowlist of email addresses; only asset URLs and unexpired share links are public.
- **Web UI** — library overview, folder sidebar with search, document reading view, upload, move/rename, replace, delete, and dark mode.
- **Netlify-native storage** — Netlify Database and Netlify Blobs are provisioned by the platform, so there is no connection string or storage credential to manage.

## Stack

Next.js 16 (App Router) · React 19 · Tailwind CSS v4 with shadcn/ui · Better Auth (Google + API keys) · Drizzle ORM on Postgres · Netlify Database and Netlify Blobs

## Getting started

### Prerequisites

- Node.js 22 or newer, and pnpm
- The [Netlify CLI](https://docs.netlify.com/api-and-cli-guides/cli-guides/get-started-with-cli/), logged in with `netlify login`
- A Netlify site with **Netlify Database** and **Netlify Blobs** enabled, linked to this checkout with `netlify link`
- A Google OAuth client (step 3)

### 1. Install

```bash
pnpm install
```

### 2. Configure

```bash
cp .env.example .env.local
```

| Variable | Required | Description |
| --- | --- | --- |
| `APP_URL` | yes | Public origin of the app, used for auth callbacks and asset URLs. `http://localhost:8888` locally. |
| `BETTER_AUTH_SECRET` | yes | At least 32 random characters; signs sessions. |
| `GOOGLE_CLIENT_ID` | yes | Google OAuth client ID. |
| `GOOGLE_CLIENT_SECRET` | yes | Google OAuth client secret. |
| `ALLOWED_GOOGLE_EMAILS` | yes | Comma-separated allowlist. Any other Google account is rejected at sign-in. |
| `BETTER_AUTH_URL` | no | Fallback for `APP_URL`. |
| `NETLIFY_BLOBS_STORE` | no | Blob store name for image bytes. Defaults to `agentboard-assets`. |

Netlify injects the database connection and the Blobs runtime context, so no database URL, site ID, or API token belongs in the environment.

### 3. Configure Google sign-in

Add both redirect URIs to the OAuth client in the Google Cloud console:

```text
http://localhost:8888/api/auth/callback/google
https://<your-site>.netlify.app/api/auth/callback/google
```

### 4. Apply database migrations

```bash
pnpm db:migrate
```

### 5. Run

```bash
netlify dev
```

Open <http://localhost:8888>, sign in with an allowlisted Google account, and create an API key under **Settings**. Netlify Dev serves the app on port 8888, proxies to the Next.js dev server on port 3000, and provides the linked site's database and Blobs context.

## Install the skill

Agentboard is meant to be driven by an agent, so the API reference ships as a skill rather than living in this README. [`skills/agentboard/SKILL.md`](skills/agentboard/SKILL.md) covers every endpoint and scope, the multipart upload with image bundles, the tree-first workflow for choosing a document path, the response shapes, and each error code.

Copy the text below into your agent and let it install the skill itself:

```text
Install the Agentboard skill so you can use the Agentboard document API.

1. Get skills/agentboard/SKILL.md from the Agentboard repository. If you have the
   repository checked out, use that copy; otherwise fetch it from GitHub:
   https://github.com/matthewdiy/agentboard/blob/main/skills/agentboard/SKILL.md
   Raw file: https://raw.githubusercontent.com/matthewdiy/agentboard/main/skills/agentboard/SKILL.md

2. Install it in your own skills directory, creating the folder if needed and
   keeping the YAML frontmatter at the top of the file:
     ~/.claude/skills/agentboard/SKILL.md for Claude Code
     ~/.hermes/skills/agentboard/SKILL.md for Hermes
   Use whatever skills directory your own runtime reads.

3. Confirm the skill loads, then ask me for the Agentboard base URL and an API key.
```

## Deployment

Agentboard deploys to Netlify, which supplies both the database and the blob storage.

1. Push the repository to GitHub and create a Netlify site from it. [`netlify.toml`](netlify.toml) sets the build command, the publish directory, Node 22, and the `/assets/*` security headers.
2. Enable **Netlify Database** and **Netlify Blobs** for the site.
3. Set the environment variables in the Netlify UI: `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_GOOGLE_EMAILS`, `APP_URL=https://<your-site>.netlify.app`, and optionally `NETLIFY_BLOBS_STORE`.
4. Add the production redirect URI to the Google OAuth client.
5. Apply migrations to the deployed database:

   ```bash
   netlify link
   pnpm db:migrate
   ```

Deploy previews and branch deploys select their own database branch automatically, and each one needs its migrations applied the same way.

## Development

```bash
pnpm test              # vitest
pnpm lint              # eslint
pnpm exec tsc --noEmit # typecheck
pnpm build             # production build
```

Schema changes: run `pnpm db:auth:schema` to regenerate the Better Auth tables, `pnpm db:generate` to create a migration, and `pnpm db:migrate` to apply it.

Two vendored files carry a local fix marked with a `Local fix:` comment: `data-active` in `components/ui/sidebar.tsx` and `data-inset` in `components/ui/dropdown-menu.tsx` are omitted rather than set to `false`, because Tailwind matches those variants on attribute presence. `components/ui/sidebar.test.tsx` guards the sidebar case, and `pnpm dlx shadcn@latest add <name> --overwrite` reintroduces the bug in either file.

Theme tokens live in `app/globals.css` and are configured through `components.json`. Repository conventions for agent contributors are in [`AGENTS.md`](AGENTS.md).
