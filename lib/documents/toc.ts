export type TocHeading = {
  id: string;
  text: string;
  level: number;
};

export type ProcessedDocumentContent = {
  html: string;
  headings: TocHeading[];
};

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * Creates a clean, URL-safe slug from heading text.
 * Supports Unicode letters and numbers across languages.
 */
export function slugify(text: string): string {
  const cleaned = text
    .replace(/<[^>]+>/g, "") // strip HTML tags
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "") // keep Unicode letters, numbers, spaces, and hyphens
    .replace(/[\s_-]+/g, "-") // collapse whitespace, underscores, and multiple hyphens
    .replace(/^-+|-+$/g, ""); // trim leading and trailing hyphens

  return cleaned || "section";
}

/**
 * Parses HTML content, extracts all headings (h1-h6), and ensures every heading
 * has a unique id attribute for anchor jumping. Pre-existing IDs are preserved.
 */
export function processHtmlHeadings(html: string): ProcessedDocumentContent {
  if (!html || !/<h[1-6]/i.test(html)) {
    return { html, headings: [] };
  }

  const headings: TocHeading[] = [];
  const slugCounts = new Map<string, number>();

  function getUniqueSlug(base: string): string {
    const count = slugCounts.get(base) ?? 0;
    slugCounts.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  }

  // Pre-scan existing IDs in headings so generated slugs don't collide with them
  const existingIdRegex = /<h[1-6][^>]*\bid=(["'])(.*?)\1/gi;
  let idScan: RegExpExecArray | null;
  while ((idScan = existingIdRegex.exec(html)) !== null) {
    const existingId = idScan[2]?.trim();
    if (existingId) {
      slugCounts.set(existingId, (slugCounts.get(existingId) ?? 0) + 1);
    }
  }

  const headingTagRegex = /<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/gi;

  const processedHtml = html.replace(
    headingTagRegex,
    (fullMatch, levelStr, attrs, innerContent) => {
      const level = Number.parseInt(levelStr, 10);
      const cleanText = decodeHtmlEntities(
        innerContent.replace(/<[^>]+>/g, "").trim(),
      );

      // If heading is completely empty, don't include it in TOC
      if (!cleanText) {
        return fullMatch;
      }

      // Check if an id attribute already exists
      const idMatch = (attrs as string).match(/\bid=(["'])(.*?)\1/i);
      let id: string;
      let newOpeningTag: string;

      if (idMatch) {
        id = idMatch[2].trim();
        newOpeningTag = `<h${level}${attrs}>`;
      } else {
        id = getUniqueSlug(slugify(cleanText));
        const cleanAttrs = (attrs as string).trim();
        newOpeningTag = `<h${level} id="${id}"${cleanAttrs ? ` ${cleanAttrs}` : ""}>`;
      }

      headings.push({
        id,
        text: cleanText,
        level,
      });

      return `${newOpeningTag}${innerContent}</h${level}>`;
    },
  );

  return {
    html: processedHtml,
    headings,
  };
}

/**
 * Extracts headings from HTML without modifying the HTML string.
 */
export function extractHeadings(html: string): TocHeading[] {
  return processHtmlHeadings(html).headings;
}
