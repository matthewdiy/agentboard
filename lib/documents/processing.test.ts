import { describe, expect, it } from "vitest";

import {
  DocumentInputError,
  normalizeAssetPath,
  parseDocumentUpload,
  renderDocument,
} from "./processing";

describe("normalizeAssetPath", () => {
  it("normalizes relative paths and Windows separators", () => {
    expect(normalizeAssetPath("./images\\hero.png")).toBe("images/hero.png");
  });

  it("rejects absolute, traversal, and encoded traversal paths", () => {
    for (const value of ["/tmp/hero.png", "C:\\hero.png", "../hero.png", "%2e%2e/hero.png"]) {
      expect(() => normalizeAssetPath(value)).toThrow(DocumentInputError);
    }
  });
});

describe("renderDocument", () => {
  const assets = [
    {
      id: "asset-1",
      sourcePath: "images/hero.png",
      publicUrl: "https://agentboard.example/assets/asset-1",
    },
  ];

  it("rewrites Markdown local images and keeps remote images", async () => {
    const html = await renderDocument(
      "markdown",
      "# Hello\n\n![Hero](./images/hero.png)\n\n![Remote](https://example.com/remote.png)",
      assets,
    );

    expect(html).toContain('src="https://agentboard.example/assets/asset-1"');
    expect(html).toContain('src="https://example.com/remote.png"');
  });

  it("rewrites HTML local images and strips unsafe markup", async () => {
    const html = await renderDocument(
      "html",
      '<h1>Hello</h1><img src="images/hero.png" onerror="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)">bad</a>',
      assets,
    );

    expect(html).toContain('src="https://agentboard.example/assets/asset-1"');
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:");
  });

  it("rejects unresolved local images", async () => {
    await expect(
      renderDocument("markdown", "![Missing](missing.png)", assets),
    ).rejects.toThrow("No uploaded asset matches");
  });
});

describe("renderDocument math", () => {
  it("renders inline and display LaTeX as MathML", async () => {
    const html = await renderDocument(
      "markdown",
      "Energy is $E = mc^2$.\n\n$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$",
      [],
    );

    expect(html).toContain('<annotation encoding="application/x-tex">E = mc^2</annotation>');
    expect(html).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">');
    expect(html).toContain("<mfrac>");
  });

  it("keeps KaTeX output free of inline styles and its HTML rendering", async () => {
    const html = await renderDocument("markdown", "$$\n\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}\n$$", []);

    // `displaystyle="false"` legitimately contains "style=", so match a real
    // style attribute by requiring the leading space.
    expect(html).not.toMatch(/\sstyle="/);
    expect(html).not.toContain("katex-html");
    expect(html).toContain('class="katex"');
  });

  it("escapes TeX source instead of letting it become markup", async () => {
    const html = await renderDocument("markdown", "$$\n<script>alert(1)</script>\n$$", []);

    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });

  it("does not honour KaTeX commands that embed URLs", async () => {
    const html = await renderDocument(
      "markdown",
      "$\\href{javascript:alert(1)}{click}$",
      [],
    );

    // The TeX source survives inside the annotation as escaped text, so assert
    // on the absence of a real attribute rather than on the string itself.
    expect(html).not.toContain("href=");
    expect(html).not.toContain("<a ");
  });

  it("renders broken LaTeX without failing the upload", async () => {
    const html = await renderDocument("markdown", "Broken $\\frac{1}{$ here.", []);

    expect(html).toContain("Broken");
    expect(html).toContain("katex-error");
  });

  it("strips MathML HTML-integration points from uploaded HTML", async () => {
    const html = await renderDocument(
      "html",
      '<math><annotation-xml encoding="text/html"><script>alert(1)</script></annotation-xml></math>',
      [],
    );

    expect(html).not.toContain("<script");
    expect(html).not.toContain("annotation-xml");
  });
});

describe("parseDocumentUpload", () => {
  it("normalizes an optional document path", async () => {
    const formData = new FormData();
    formData.append("document", new File(["# Hello"], "app.md", { type: "text/markdown" }));
    formData.append("manifest", "[]");
    formData.append("path", "product\\app.md");

    const upload = await parseDocumentUpload(formData);

    expect(upload.path).toBe("/product/app.md");
    expect(upload.title).toBe("app");
  });

  it("reports invalid document paths as input errors", async () => {
    const formData = new FormData();
    formData.append("document", new File(["# Hello"], "app.md"));
    formData.append("manifest", "[]");
    formData.append("path", "../app.md");

    await expect(parseDocumentUpload(formData)).rejects.toThrow(DocumentInputError);
  });

  it("reports an unsafe default filename as an input error", async () => {
    const formData = new FormData();
    formData.append("document", new File(["# Hello"], "bad\nname.md"));
    formData.append("manifest", "[]");

    await expect(parseDocumentUpload(formData)).rejects.toThrow(DocumentInputError);
  });

  it("accepts a document with no manifest field", async () => {
    const formData = new FormData();
    formData.append("document", new File(["# Hello"], "app.md"));

    const upload = await parseDocumentUpload(formData);

    expect(upload.assets).toEqual([]);
    expect(upload.source).toBe("# Hello");
  });

  it.each(["", "   "])("treats a blank manifest (%j) as no assets", async (manifest) => {
    const formData = new FormData();
    formData.append("document", new File(["# Hello"], "app.md"));
    formData.append("manifest", manifest);

    const upload = await parseDocumentUpload(formData);

    expect(upload.assets).toEqual([]);
  });

  it.each(["{", '{"field":"asset_0"}', '"asset_0"'])(
    "rejects a malformed manifest %j",
    async (manifest) => {
      const formData = new FormData();
      formData.append("document", new File(["# Hello"], "app.md"));
      formData.append("manifest", manifest);

      await expect(parseDocumentUpload(formData)).rejects.toThrow(
        "The multipart manifest is invalid.",
      );
    },
  );

  it("rejects a manifest sent as a file instead of a JSON string", async () => {
    const formData = new FormData();
    formData.append("document", new File(["# Hello"], "app.md"));
    formData.append("manifest", new File(["[]"], "manifest.json"));

    await expect(parseDocumentUpload(formData)).rejects.toThrow(
      "The multipart manifest is invalid.",
    );
  });
});
