import { describe, expect, it } from "vitest";

import {
  extractHeadings,
  processHtmlHeadings,
  slugify,
} from "./toc";

describe("slugify", () => {
  it("converts strings to clean URL-safe slugs", () => {
    expect(slugify("Hello World")).toBe("hello-world");
    expect(slugify("  Special   Spacing   ")).toBe("special-spacing");
    expect(slugify("Architecture & System Design (v2.0)")).toBe(
      "architecture-system-design-v20",
    );
  });

  it("handles Unicode characters properly", () => {
    expect(slugify("系统架构与设计")).toBe("系统架构与设计");
    expect(slugify("Éléments Clés")).toBe("éléments-clés");
    expect(slugify("Überblick")).toBe("überblick");
  });

  it("strips HTML tags and falls back to section when empty", () => {
    expect(slugify("<code>fetch()</code> API")).toBe("fetch-api");
    expect(slugify("!@#$%^&*()")).toBe("section");
    expect(slugify("")).toBe("section");
  });
});

describe("processHtmlHeadings", () => {
  it("extracts headings and injects unique IDs into HTML", () => {
    const input =
      "<h2>Overview</h2><p>Intro text</p><h3>Installation</h3><p>Steps</p>";
    const result = processHtmlHeadings(input);

    expect(result.headings).toEqual([
      { id: "overview", text: "Overview", level: 2 },
      { id: "installation", text: "Installation", level: 3 },
    ]);

    expect(result.html).toContain('<h2 id="overview">Overview</h2>');
    expect(result.html).toContain('<h3 id="installation">Installation</h3>');
  });

  it("preserves pre-existing IDs on headings", () => {
    const input =
      '<h2 id="custom-anchor" class="text-xl">Custom Heading</h2><p>Text</p>';
    const result = processHtmlHeadings(input);

    expect(result.headings).toEqual([
      { id: "custom-anchor", text: "Custom Heading", level: 2 },
    ]);
    expect(result.html).toContain('id="custom-anchor"');
    expect(result.html).toContain('class="text-xl"');
  });

  it("handles duplicate heading names with numeric suffixes", () => {
    const input =
      "<h2>Overview</h2><p>Part 1</p><h2>Overview</h2><p>Part 2</p><h2>Overview</h2>";
    const result = processHtmlHeadings(input);

    expect(result.headings.map((h) => h.id)).toEqual([
      "overview",
      "overview-1",
      "overview-2",
    ]);
    expect(result.html).toContain('<h2 id="overview">Overview</h2>');
    expect(result.html).toContain('<h2 id="overview-1">Overview</h2>');
    expect(result.html).toContain('<h2 id="overview-2">Overview</h2>');
  });

  it("decodes HTML entities and strips inner tags from heading titles", () => {
    const input =
      "<h2>Tips &amp; Tricks for <code>async/await</code></h2>";
    const result = processHtmlHeadings(input);

    expect(result.headings[0]).toEqual({
      id: "tips-tricks-for-asyncawait",
      text: "Tips & Tricks for async/await",
      level: 2,
    });
  });

  it("returns original content and empty headings when no headings present", () => {
    const input = "<p>Just a paragraph without any headings.</p>";
    const result = processHtmlHeadings(input);

    expect(result.headings).toEqual([]);
    expect(result.html).toBe(input);
  });
});

describe("extractHeadings", () => {
  it("extracts list of headings without modifying input", () => {
    const input = "<h1>Title</h1><h2>Section A</h2><h3>Sub B</h3>";
    const headings = extractHeadings(input);

    expect(headings).toHaveLength(3);
    expect(headings[0]).toEqual({ id: "title", text: "Title", level: 1 });
    expect(headings[1]).toEqual({ id: "section-a", text: "Section A", level: 2 });
    expect(headings[2]).toEqual({ id: "sub-b", text: "Sub B", level: 3 });
  });
});
