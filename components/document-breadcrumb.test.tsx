import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DocumentBreadcrumb } from "@/components/document-breadcrumb";
import { DocumentTreeProvider } from "@/lib/hooks/use-document-tree";

const dummyTreePage = {
  parentPath: "/",
  cursor: null,
  nextCursor: null,
  entries: [],
};

describe("DocumentBreadcrumb", () => {
  it("renders fallback Document breadcrumb when path is null or undefined", () => {
    const html = renderToStaticMarkup(
      <DocumentTreeProvider initialPage={dummyTreePage}>
        <DocumentBreadcrumb path={null} />
      </DocumentTreeProvider>,
    );

    expect(html).toContain("Library");
    expect(html).toContain("Document");
  });

  it("renders segmented breadcrumb when path is provided", () => {
    const html = renderToStaticMarkup(
      <DocumentTreeProvider initialPage={dummyTreePage}>
        <DocumentBreadcrumb path="/guides/frontend/overview.md" />
      </DocumentTreeProvider>,
    );

    expect(html).toContain("Library");
    expect(html).toContain("guides");
    expect(html).toContain("frontend");
    expect(html).toContain("overview.md");
  });
});
