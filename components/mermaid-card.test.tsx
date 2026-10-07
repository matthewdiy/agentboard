import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockImplementation(async (id: string, code: string) => {
      if (code.includes("INVALID")) {
        throw new Error("Syntax error in graph");
      }
      return { svg: `<svg id="${id}"><text>mocked-svg</text></svg>` };
    }),
  },
}));

import { MermaidCard } from "@/components/mermaid-card";

describe("MermaidCard", () => {
  it("renders diagram type badge and controls toolbar in static markup", () => {
    const code = "flowchart TD\n  A --> B";
    const html = renderToStaticMarkup(<MermaidCard code={code} isDark={false} />);

    expect(html).toContain("mermaid-wrapper");
    expect(html).toContain("Flowchart");
    expect(html).toContain("Copy diagram source");
  });

  it("infers sequence diagram type correctly", () => {
    const code = "sequenceDiagram\n  Alice->>Bob: Hello";
    const html = renderToStaticMarkup(<MermaidCard code={code} isDark={true} />);

    expect(html).toContain("Sequence Diagram");
  });

  it("infers architecture and ER diagram types correctly", () => {
    const code = "erDiagram\n  CUSTOMER ||--o{ ORDER : places";
    const html = renderToStaticMarkup(<MermaidCard code={code} isDark={false} />);

    expect(html).toContain("Entity Relationship");
  });
});
