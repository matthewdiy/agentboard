import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TableOfContents } from "@/components/table-of-contents";
import type { TocHeading } from "@/lib/documents/toc";

describe("TableOfContents", () => {
  const sampleHeadings: TocHeading[] = [
    { id: "introduction", text: "Introduction", level: 1 },
    { id: "installation", text: "Installation", level: 2 },
    { id: "prerequisites", text: "Prerequisites", level: 3 },
    { id: "usage", text: "Usage", level: 2 },
  ];

  it("renders navigation element with heading links", () => {
    const html = renderToStaticMarkup(
      <TableOfContents headings={sampleHeadings} />,
    );

    expect(html).toContain("On this page");
    expect(html).toContain('href="#introduction"');
    expect(html).toContain("Introduction");
    expect(html).toContain('href="#installation"');
    expect(html).toContain("Installation");
    expect(html).toContain('href="#prerequisites"');
    expect(html).toContain("Prerequisites");
    expect(html).toContain('href="#usage"');
    expect(html).toContain("Usage");
  });

  it("renders nothing when headings list is empty", () => {
    const html = renderToStaticMarkup(<TableOfContents headings={[]} />);
    expect(html).toBe("");
  });

  it("renders with a custom title when provided", () => {
    const html = renderToStaticMarkup(
      <TableOfContents
        headings={sampleHeadings}
        title="Document Outline"
      />,
    );

    expect(html).toContain("Document Outline");
  });

  it("applies depth padding for hierarchical nesting", () => {
    const html = renderToStaticMarkup(
      <TableOfContents headings={sampleHeadings} />,
    );

    // Level 1 is depth 0 (pl-1.5)
    // Level 2 is depth 1 (pl-3.5)
    // Level 3 is depth 2 (pl-5)
    expect(html).toContain("pl-1.5");
    expect(html).toContain("pl-3.5");
    expect(html).toContain("pl-5");
  });
});
