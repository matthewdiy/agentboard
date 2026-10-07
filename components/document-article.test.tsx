import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DocumentArticle } from "@/components/document-article";

describe("DocumentArticle", () => {
  it("renders server-side HTML directly into article element when no diagrams are present", () => {
    const html = renderToStaticMarkup(
      <DocumentArticle
        html="<h2>Section</h2><p>Normal text</p>"
        className="test-class"
      />,
    );

    expect(html).toContain("document-content");
    expect(html).toContain("test-class");
    expect(html).toContain("<h2>Section</h2><p>Normal text</p>");
  });

  it("parses mermaid fences into MermaidCard components", () => {
    const markup = '<h2>Architecture</h2><pre><code class="hljs language-mermaid">graph TD;\n  A--&gt;B;\n</code></pre><p>Footer</p>';
    const html = renderToStaticMarkup(
      <DocumentArticle html={markup} />,
    );

    expect(html).toContain("Architecture</h2>");
    expect(html).toContain("mermaid-wrapper");
    expect(html).toContain("Flowchart");
    expect(html).toContain("Footer</p>");
  });
});
