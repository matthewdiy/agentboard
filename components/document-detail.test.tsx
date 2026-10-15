import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

import { DocumentDetail } from "@/components/document-detail";
import type { DocumentResponse } from "@/lib/documents/service";
import { DocumentTreeProvider } from "@/lib/hooks/use-document-tree";

const dummyTreePage = {
  parentPath: "/",
  cursor: null,
  nextCursor: null,
  entries: [],
};

const sampleDoc: DocumentResponse = {
  id: "doc-123",
  title: "My Special Title",
  path: "/engineering/architecture.md",
  sourceFormat: "markdown",
  sourceBytes: 1024,
  sourceFilename: "architecture.md",
  contentHash: "hash-123",
  createdAt: "2026-09-30T10:00:00Z",
  updatedAt: "2026-09-30T12:00:00Z",
  sourceContent: "# Architecture Heading\n\nDoc content here",
  sanitizedHtml: "<h1>Architecture Heading</h1><p>Doc content here</p>",
  assets: [],
};

describe("DocumentDetail", () => {
  it("does not render document title or breadcrumbs in main section, but renders metadata and article content", () => {
    const html = renderToStaticMarkup(
      <DocumentTreeProvider initialPage={dummyTreePage}>
        <DocumentDetail document={sampleDoc} />
      </DocumentTreeProvider>,
    );

    // Title should NOT be rendered in the document detail main section
    expect(html).not.toContain("My Special Title");

    // Breadcrumb library link should NOT be rendered in document detail (it is in header now)
    expect(html).not.toContain("Library");

    // Metadata and article content SHOULD be rendered
    expect(html).toContain("markdown");
    expect(html).toContain("Copy path");
    expect(html).toContain("Architecture Heading");
    expect(html).toContain("Doc content here");
  });

  it("renders Table of Contents and injects anchor IDs when document contains multiple headings", () => {
    const multiHeadingDoc: DocumentResponse = {
      ...sampleDoc,
      sanitizedHtml:
        "<h2>Introduction</h2><p>Intro</p><h2>System Architecture</h2><p>Arch</p><h3>Database Layer</h3><p>DB</p>",
    };

    const html = renderToStaticMarkup(
      <DocumentTreeProvider initialPage={dummyTreePage}>
        <DocumentDetail document={multiHeadingDoc} />
      </DocumentTreeProvider>,
    );

    // Article content has anchor IDs injected
    expect(html).toContain('<h2 id="introduction">Introduction</h2>');
    expect(html).toContain('<h2 id="system-architecture">System Architecture</h2>');
    expect(html).toContain('<h3 id="database-layer">Database Layer</h3>');

    // Table of contents navigation is rendered
    expect(html).toContain("On this page");
    expect(html).toContain('href="#introduction"');
    expect(html).toContain('href="#system-architecture"');
    expect(html).toContain('href="#database-layer"');
  });
});

