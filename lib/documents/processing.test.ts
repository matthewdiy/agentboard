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

describe("renderDocument code highlight", () => {
  it("highlights TypeScript code blocks with semantic hljs spans", async () => {
    const source = "```typescript\ninterface AgentRecord {\n  id: string;\n  count: number;\n}\n```";
    const html = await renderDocument("markdown", source, []);

    expect(html).toContain('<pre><code class="hljs language-typescript">');
    expect(html).toContain('<span class="hljs-keyword">interface</span>');
    expect(html).toContain('<span class="hljs-title class_">AgentRecord</span>');
    expect(html).toContain('<span class="hljs-built_in">string</span>');
    expect(html).toContain('<span class="hljs-built_in">number</span>');
  });

  it("highlights Python code blocks", async () => {
    const source = "```python\ndef compute_embedding(text: str) -> list:\n    # Return vector\n    return [0.1, 0.2]\n```";
    const html = await renderDocument("markdown", source, []);

    expect(html).toContain('<pre><code class="hljs language-python">');
    expect(html).toContain('<span class="hljs-keyword">def</span>');
    expect(html).toContain('<span class="hljs-title function_">compute_embedding</span>');
    expect(html).toContain('<span class="hljs-comment"># Return vector</span>');
    expect(html).toContain('<span class="hljs-keyword">return</span>');
    expect(html).toContain('<span class="hljs-number">0.1</span>');
  });

  it("renders untagged code blocks cleanly without errors", async () => {
    const source = "```\nPlain text content\nwithout language tag\n```";
    const html = await renderDocument("markdown", source, []);

    expect(html).toContain("<pre><code>");
    expect(html).toContain("Plain text content");
    expect(html).not.toContain("hljs-");
  });

  it("handles unknown language tags gracefully without failing", async () => {
    const source = "```unknownnonexistentlang\nfoo = bar()\n```";
    const html = await renderDocument("markdown", source, []);

    expect(html).toContain("foo = bar()");
    expect(html).toContain("<pre><code");
  });

  it("sanitizes malicious markup inside code blocks while preserving hljs spans", async () => {
    const source = '```javascript\nconst x = "<img src=x onerror=alert(1)>";\n```';
    const html = await renderDocument("markdown", source, []);

    expect(html).toContain('<span class="hljs-keyword">const</span>');
    expect(html).toContain('<span class="hljs-string">"&lt;img src=x onerror=alert(1)&gt;"</span>');
    expect(html).not.toContain("<img");
  });
});

describe("renderDocument video embedding", () => {
  it("renders standard YouTube embed iframes", async () => {
    const source = '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" allowfullscreen></iframe>';
    const html = await renderDocument("markdown", source, []);

    expect(html).toContain('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" allowfullscreen');
  });

  it("normalizes YouTube watch links to embed URLs", async () => {
    const source = '<iframe src="https://www.youtube.com/watch?v=dQw4w9WgXcQ"></iframe>';
    const html = await renderDocument("markdown", source, []);

    expect(html).toContain('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"');
  });

  it("normalizes youtu.be shortlinks with timestamps to embed URLs", async () => {
    const source = '<iframe src="https://youtu.be/dQw4w9WgXcQ?t=45"></iframe>';
    const html = await renderDocument("markdown", source, []);

    expect(html).toContain('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ?start=45"');
  });

  it("normalizes YouTube shorts URLs to embed URLs", async () => {
    const source = '<iframe src="https://www.youtube.com/shorts/abc123xyz"></iframe>';
    const html = await renderDocument("markdown", source, []);

    expect(html).toContain('<iframe src="https://www.youtube.com/embed/abc123xyz"');
  });

  it("normalizes Vimeo video URLs to embed URLs", async () => {
    const source = '<iframe src="https://vimeo.com/76979871"></iframe>';
    const html = await renderDocument("markdown", source, []);

    expect(html).toContain('<iframe src="https://player.vimeo.com/video/76979871"');
  });

  it("normalizes Loom share URLs to embed URLs", async () => {
    const source = '<iframe src="https://www.loom.com/share/1234567890abcdef"></iframe>';
    const html = await renderDocument("markdown", source, []);

    expect(html).toContain('<iframe src="https://www.loom.com/embed/1234567890abcdef"');
  });

  it("normalizes Bilibili video URLs to embed URLs", async () => {
    const source = '<iframe src="https://www.bilibili.com/video/BV1xx411c7mD"></iframe>';
    const html = await renderDocument("markdown", source, []);

    expect(html).toContain('<iframe src="https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&amp;page=1"');
  });

  it("normalizes Dailymotion video URLs to embed URLs", async () => {
    const source = '<iframe src="https://www.dailymotion.com/video/x7tgad0"></iframe>';
    const html = await renderDocument("markdown", source, []);

    expect(html).toContain('<iframe src="https://www.dailymotion.com/embed/video/x7tgad0"');
  });

  it("preserves HTML5 video tags with controls and poster", async () => {
    const source = '<video src="https://cdn.example.com/demo.mp4" controls poster="https://cdn.example.com/poster.jpg" preload="metadata"></video>';
    const html = await renderDocument("markdown", source, []);

    expect(html).toContain('<video src="https://cdn.example.com/demo.mp4" controls poster="https://cdn.example.com/poster.jpg" preload="metadata"></video>');
  });

  it("preserves HTML5 video with source and track children", async () => {
    const source = '<video controls><source src="https://cdn.example.com/demo.webm" type="video/webm"><track src="https://cdn.example.com/sub.vtt" kind="subtitles" srclang="en" label="English"></video>';
    const html = await renderDocument("markdown", source, []);

    expect(html).toContain('<video controls>');
    expect(html).toContain('<source src="https://cdn.example.com/demo.webm" type="video/webm"');
    expect(html).toContain('<track src="https://cdn.example.com/sub.vtt" kind="subtitles" srclang="en" label="English"');
  });

  it("auto-converts Markdown image syntax with video extension to a video tag", async () => {
    const source = "![Product Demo](https://cdn.example.com/walkthrough.mp4)";
    const html = await renderDocument("markdown", source, []);

    expect(html).toContain('<video src="https://cdn.example.com/walkthrough.mp4" controls playsinline title="Product Demo"></video>');
    expect(html).not.toContain("<img");
  });

  it("discards iframes pointing to unauthorized hostnames", async () => {
    const source = '<iframe src="https://evil.com/phishing"></iframe>';
    const html = await renderDocument("markdown", source, []);

    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("evil.com");
  });

  it("strips insecure javascript: schemes and onerror handlers from video elements", async () => {
    const source = '<video src="javascript:alert(1)" onerror="alert(2)"></video>';
    const html = await renderDocument("markdown", source, []);

    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("alert");
  });
});

describe("renderDocument mermaid diagrams", () => {
  it("preserves Markdown mermaid code blocks with clean language class", async () => {
    const source = "```mermaid\ngraph TD;\n    A[Client] --> B[Server];\n```";
    const html = await renderDocument("markdown", source, []);

    expect(html).toContain('<pre><code class="hljs language-mermaid">');
    expect(html).toContain("graph TD;");
    expect(html).toContain("A[Client] --&gt; B[Server];");
  });

  it("preserves explicit HTML div.mermaid and pre.mermaid elements", async () => {
    const source = '<div class="mermaid">flowchart LR\n  X --> Y</div><pre class="mermaid"><code>graph TD\n  1 --> 2</code></pre>';
    const html = await renderDocument("html", source, []);

    expect(html).toContain('<div class="mermaid">flowchart LR\n  X --&gt; Y</div>');
    expect(html).toContain('<pre class="mermaid"><code>graph TD\n  1 --&gt; 2</code></pre>');
  });

  it("sanitizes event handlers and scripts inside mermaid blocks", async () => {
    const source = '<div class="mermaid" onclick="alert(1)"><script>alert(2)</script>sequenceDiagram\nAlice->>Bob: Hello</div>';
    const html = await renderDocument("html", source, []);

    expect(html).toContain('<div class="mermaid">');
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("<script");
    expect(html).toContain("Alice-&gt;&gt;Bob: Hello");
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
