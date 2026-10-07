"use client";

import { useMemo } from "react";
import { useTheme } from "next-themes";
import { cn } from "cn";

import { MermaidCard } from "@/components/mermaid-card";

type DocumentArticleProps = {
  html: string;
  className?: string;
};

type ContentSegment =
  | { type: "html"; content: string }
  | { type: "mermaid"; code: string };

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function parseDocumentSegments(html: string): ContentSegment[] {
  // Matches:
  // 1. <pre><code class="hljs language-mermaid">...</code></pre>
  // 2. <pre><code class="language-mermaid">...</code></pre>
  // 3. <pre class="mermaid"><code>...</code></pre>
  // 4. <div class="mermaid">...</div>
  const regex =
    /<pre><code class="hljs language-mermaid">([\s\S]*?)<\/code><\/pre>|<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>|<pre class="mermaid"><code>([\s\S]*?)<\/code><\/pre>|<div class="mermaid">([\s\S]*?)<\/div>/gi;

  let lastIndex = 0;
  const segments: ContentSegment[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: "html",
        content: html.slice(lastIndex, match.index),
      });
    }

    const rawCode = match[1] || match[2] || match[3] || match[4] || "";
    const cleanCode = decodeHtmlEntities(rawCode).trim();

    segments.push({
      type: "mermaid",
      code: cleanCode,
    });

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < html.length) {
    segments.push({
      type: "html",
      content: html.slice(lastIndex),
    });
  }

  return segments;
}

export function DocumentArticle({ html, className }: DocumentArticleProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const segments = useMemo(() => parseDocumentSegments(html), [html]);

  const hasMermaid = segments.some((s) => s.type === "mermaid");

  if (!hasMermaid) {
    return (
      <article
        className={cn("document-content", className)}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <article className={cn("document-content", className)}>
      {segments.map((segment, index) =>
        segment.type === "mermaid" ? (
          <MermaidCard
            key={`mermaid-segment-${index}`}
            code={segment.code}
            isDark={isDark}
          />
        ) : (
          <div
            key={`html-segment-${index}`}
            dangerouslySetInnerHTML={{ __html: segment.content }}
          />
        ),
      )}
    </article>
  );
}
