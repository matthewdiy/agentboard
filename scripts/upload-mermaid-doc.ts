import { createDocument } from "@/lib/documents/mutations";
import { createDocumentShare } from "@/lib/documents/share-store";

const markdownSource = `# Agent System Architecture & Specifications

This document demonstrates Agentboard's native Mermaid diagram support for technical documentation and AI agent workflows.

## 1. System Overview Flowchart

\`\`\`mermaid
flowchart TD
    subgraph ClientLayer["Client & Agent Layer"]
        Agent["🤖 AI Agent (Hermes)"]
        Browser["🌐 Web User (Dashboard)"]
        ShareViewer["👥 Public Link Visitor"]
    end

    subgraph Gateway["Agentboard Next.js 16 Gateway"]
        Auth["Better Auth Guard\\n(Bearer API Key / Google OAuth)"]
        Router["App Router & API Endpoints"]
        Processor["Markdown / Unified Pipeline\\n(Rehype, KaTeX MathML, Mermaid)"]
    end

    subgraph Storage["Persistence Layer"]
        Postgres[("🐘 Postgres Database\\n(Materialized Path Tree)")]
        Blobs[("📦 Netlify Blobs\\n(Image Asset Storage)")]
    end

    Agent -->|Bearer Token / REST API| Auth
    Browser -->|Session Cookie| Auth
    ShareViewer -->|Public Share Token /s/:token| Router
    Auth --> Router
    Router --> Processor
    Processor --> Postgres
    Processor --> Blobs
\`\`\`

## 2. API Request Sequence Diagram

\`\`\`mermaid
sequenceDiagram
    autonumber
    actor Agent as AI Agent
    participant API as Agentboard API
    participant Sanitizer as Unified Pipeline
    participant DB as Postgres
    participant Storage as Netlify Blobs

    Agent->>API: POST /api/v1/documents (multipart)
    activate API
    API->>API: Verify Bearer ab_* Key
    API->>Storage: Store bundled images
    API->>Sanitizer: Process Markdown & rewrite asset URLs
    Sanitizer-->>API: Return sanitizedHtml
    API->>DB: Transactionally insert document & path nodes
    DB-->>API: Confirm commit
    API-->>Agent: 201 Created (ID, Path, Title)
    deactivate API
\`\`\`

## 3. Document Lifecycle State Machine

\`\`\`mermaid
stateDiagram-v2
    [*] --> Draft : Agent Upload
    Draft --> Published : Create Public Share
    Published --> Active : Read / Browse
    Active --> Revoked : Revoke Share Link
    Active --> Expired : Expiry Date Reached
    Revoked --> [*] : Purge Record
    Expired --> [*] : Purge Record
\`\`\`

## 4. Entity-Relationship Model

\`\`\`mermaid
erDiagram
    DOCUMENT_NODES ||--o{ DOCUMENT_CONTENTS : contains
    DOCUMENT_NODES ||--o{ DOCUMENT_ASSETS : owns
    DOCUMENT_NODES ||--o{ DOCUMENT_SHARES : has

    DOCUMENT_NODES {
        uuid id PK
        enum kind
        uuid parent_id FK
        text path
        text title
        enum source_format
    }

    DOCUMENT_CONTENTS {
        uuid node_id PK,FK
        text source_content
        text sanitized_html
    }

    DOCUMENT_SHARES {
        uuid id PK
        uuid node_id FK
        text token_hash
        text name
        timestamp expires_at
        timestamp revoked_at
    }
\`\`\`

## 5. Graceful Syntax Error Test

Below is an intentionally malformed diagram to verify that syntax errors fall back cleanly without breaking the page:

\`\`\`mermaid
graph TD
    A --> [Malformed Bracket Node
    B -->
\`\`\`

## 6. Mathematical Formulas & Video Integration

Mermaid integrates seamlessly with other Agentboard features:

$$E = mc^2 \\quad \\text{and} \\quad \\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}$$

<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" allowfullscreen></iframe>
`;

async function main() {
  const path = `/specs/architecture-${Date.now().toString().slice(-4)}.md`;
  console.log(`Creating document at path: ${path}...`);

  const doc = await createDocument({
    filename: "architecture.md",
    path,
    title: "System Architecture & Diagrams",
    format: "markdown",
    source: markdownSource,
    sourceBytes: Buffer.byteLength(markdownSource, "utf8"),
    assets: [],
  });

  if (!doc) {
    throw new Error("Failed to create document");
  }

  console.log(`Document created with ID: ${doc.id}`);

  const share = await createDocumentShare(doc.id, {
    name: "Mermaid Test Share",
    expiresAt: null,
  });

  if (!share) {
    throw new Error("Failed to create share link");
  }

  console.log(`Share token: ${share.token}`);
  console.log(`Share URL: ${share.url}`);
  console.log(`Direct local port 8888 URL: http://localhost:8888/s/${share.token}`);
  console.log(`Direct local port 3000 URL: http://localhost:3000/s/${share.token}`);
}

main().catch((err) => {
  console.error("Upload error:", err);
  process.exit(1);
});
