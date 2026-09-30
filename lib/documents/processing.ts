import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import sanitizeHtml from "sanitize-html";
import { unified } from "unified";
import { z } from "zod";

import { uploadLimits } from "@/lib/env";
import {
  documentPathFromFilename,
  DocumentPathError,
  normalizeDocumentPath,
} from "@/lib/documents/paths";

const manifestSchema = z.array(
  z.object({
    field: z.string().min(1).max(120),
    path: z.string().min(1).max(500),
  }),
);

const allowedImageTypes = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const extensionMimeTypes: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export type DocumentFormat = "markdown" | "html";

export type UploadedAsset = {
  path: string;
  mimeType: string;
  sizeBytes: number;
  bytes: ArrayBuffer;
};

export type ParsedDocumentUpload = {
  filename: string;
  path?: string;
  title: string;
  format: DocumentFormat;
  source: string;
  sourceBytes: number;
  assets: UploadedAsset[];
};

export type ProcessedAssetReference = {
  id: string;
  sourcePath: string;
  publicUrl: string;
};

export class DocumentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentInputError";
  }
}

export function normalizeAssetPath(input: string) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    throw new DocumentInputError(`Invalid encoded asset path: ${input}`);
  }

  const withoutFragment = decoded.split("#", 1)[0] ?? "";
  const withoutQuery = withoutFragment.split("?", 1)[0] ?? "";
  const normalized = withoutQuery
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/");

  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split("/").some((segment) => segment === "..") ||
    normalized.includes("\0")
  ) {
    throw new DocumentInputError(`Unsafe asset path: ${input}`);
  }

  return normalized;
}

function splitReference(reference: string) {
  const match = reference.match(/^([^?#]*)([?#][\s\S]*)?$/);
  return {
    path: match?.[1] ?? reference,
    suffix: match?.[2] ?? "",
  };
}

function isRemoteHttpUrl(reference: string) {
  return /^https?:\/\//i.test(reference);
}

function resolveReference(
  reference: string,
  assets: Map<string, ProcessedAssetReference>,
) {
  const trimmed = reference.trim();
  if (isRemoteHttpUrl(trimmed)) return trimmed;

  if (/^(?:data|javascript|vbscript|file):/i.test(trimmed)) {
    throw new DocumentInputError(`Unsafe image URL: ${reference}`);
  }

  const { path, suffix } = splitReference(trimmed);
  const normalizedPath = normalizeAssetPath(path);
  const asset = assets.get(normalizedPath);

  if (!asset) {
    throw new DocumentInputError(`No uploaded asset matches: ${normalizedPath}`);
  }

  return `${asset.publicUrl}${suffix}`;
}

function rewriteHtmlImages(
  source: string,
  assets: Map<string, ProcessedAssetReference>,
) {
  return source.replace(
    /(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"']*)(\2)/gi,
    (_match, prefix: string, quote: string, reference: string, closing: string) =>
      `${prefix}${quote}${resolveReference(reference, assets)}${closing}`,
  );
}

function rewriteMarkdownImages(
  source: string,
  assets: Map<string, ProcessedAssetReference>,
) {
  return source.replace(
    /(!\[[^\]]*\]\(\s*)(<[^>]+>|"[^"\n]*"|'[^'\n]*'|[^\s)]+)([\s\S]*?\))/g,
    (_match, prefix: string, rawDestination: string, suffix: string) => {
      const destination = rawDestination.replace(/^<|>$/g, "").replace(/^['"]|['"]$/g, "");
      const rewritten = resolveReference(destination, assets);
      return `${prefix}${rewritten}${suffix}`;
    },
  );
}

// KaTeX is configured for MathML-only output, so the reading preview needs no
// third-party stylesheet and produces no inline `style` attributes. Only the
// presentation elements KaTeX actually emits are allowed through.
const mathmlTags = [
  "annotation",
  "math",
  "menclose",
  "merror",
  "mfrac",
  "mi",
  "mmultiscripts",
  "mn",
  "mo",
  "mover",
  "mpadded",
  "mphantom",
  "mprescripts",
  "mroot",
  "mrow",
  "ms",
  "mspace",
  "msqrt",
  "mstyle",
  "msub",
  "msubsup",
  "msup",
  "mtable",
  "mtd",
  "mtext",
  "mtr",
  "munder",
  "munderover",
  "none",
  "semantics",
  "span",
];

const mathmlAttributes: sanitizeHtml.IOptions["allowedAttributes"] = {
  math: ["xmlns", "display"],
  annotation: ["encoding"],
  mi: ["mathvariant"],
  mo: [
    "fence",
    "form",
    "largeop",
    "lspace",
    "movablelimits",
    "rspace",
    "separator",
    "stretchy",
    "symmetric",
  ],
  ms: ["lquote", "rquote"],
  mspace: ["depth", "height", "width"],
  menclose: ["notation"],
  mfrac: ["linethickness"],
  mpadded: ["depth", "height", "lspace", "voffset", "width"],
  mstyle: ["displaystyle", "scriptlevel"],
  mtable: ["columnalign", "columnspacing", "rowspacing"],
  mtd: ["columnalign", "columnspan", "rowspan"],
  mtr: ["columnalign", "rowspacing"],
  mover: ["accent"],
  munder: ["accentunder"],
  munderover: ["accent", "accentunder"],
};

const safeHtmlOptions: sanitizeHtml.IOptions = {
  allowedTags: [
    "a",
    "blockquote",
    "br",
    "code",
    "del",
    "details",
    "em",
    "figcaption",
    "figure",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "img",
    "li",
    "ol",
    "p",
    "pre",
    "s",
    "strong",
    "summary",
    "sub",
    "sup",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "tr",
    "ul",
    ...mathmlTags,
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title", "width", "height", "loading"],
    th: ["colspan", "rowspan"],
    td: ["colspan", "rowspan"],
    // KaTeX wraps MathML in <span class="katex">, which is the only styling
    // hook the reading view needs.
    span: ["class"],
    ...mathmlAttributes,
  },
  allowedClasses: {
    // `katex-error` marks a formula KaTeX could not parse, so a broken equation
    // stays visible to whoever uploaded it instead of reading as plain text.
    span: ["katex", "katex-error"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: {
    a: ["http", "https", "mailto"],
    img: ["http", "https"],
  },
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  enforceHtmlBoundary: true,
};

export async function renderDocument(
  format: DocumentFormat,
  source: string,
  assets: ProcessedAssetReference[],
) {
  const assetMap = new Map(
    assets.map((asset) => [normalizeAssetPath(asset.sourcePath), asset]),
  );
  const rewrittenSource =
    format === "markdown"
      ? rewriteHtmlImages(rewriteMarkdownImages(source, assetMap), assetMap)
      : rewriteHtmlImages(source, assetMap);

  const generatedHtml =
    format === "markdown"
      ? String(
          await unified()
            .use(remarkParse)
            .use(remarkGfm)
            .use(remarkMath)
            .use(remarkRehype, { allowDangerousHtml: true })
            .use(rehypeRaw)
            // MathML output keeps KaTeX self-contained: no stylesheet, no inline
            // styles, and a sanitizer allowlist small enough to audit.
            // rehype-katex renders unparseable formulas as a `katex-error` span
            // rather than throwing, so a bad equation never fails an upload.
            .use(rehypeKatex, { output: "mathml" })
            .use(rehypeStringify)
            .process(rewrittenSource),
        )
      : rewrittenSource;

  return sanitizeHtml(generatedHtml, safeHtmlOptions);
}

function inferImageMimeType(file: File, path: string) {
  const supplied = file.type.toLowerCase();
  if (allowedImageTypes.has(supplied)) return supplied;

  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
  return extensionMimeTypes[extension] ?? "";
}

function titleFromFilename(filename: string) {
  return filename.replace(/\.(?:md|markdown|html?|htm)$/i, "").trim() || "Untitled document";
}

export const maxTitleLength = 160;

/**
 * Shared by uploads and renames so a title can never be empty or longer than
 * the column expects, whichever path it arrives through.
 */
export function normalizeDocumentTitle(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new DocumentInputError("A document title is required.");
  }
  return trimmed.slice(0, maxTitleLength);
}

export async function parseDocumentUpload(formData: FormData): Promise<ParsedDocumentUpload> {
  const documentFile = formData.get("document");
  if (!(documentFile instanceof File)) {
    throw new DocumentInputError("A document file is required.");
  }

  if (documentFile.size > uploadLimits.maxDocumentBytes) {
    throw new DocumentInputError("The document is larger than the 4 MB limit.");
  }

  const filename = documentFile.name || "document.md";
  const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  const format: DocumentFormat =
    extension === ".html" || extension === ".htm" ? "html" :
    extension === ".md" || extension === ".markdown" ? "markdown" :
    (() => {
      throw new DocumentInputError("Only .md, .markdown, .html, and .htm are supported.");
    })();

  // The manifest is optional: a document without local images omits the field
  // entirely. A document that does reference a local image without a matching
  // manifest entry still fails in renderDocument(), so nothing is stored with
  // broken image links.
  const manifestRaw = formData.get("manifest");
  if (manifestRaw !== null && typeof manifestRaw !== "string") {
    throw new DocumentInputError("The multipart manifest is invalid.");
  }

  let manifest: z.infer<typeof manifestSchema> = [];
  const manifestText = manifestRaw?.trim() ?? "";
  if (manifestText) {
    try {
      manifest = manifestSchema.parse(JSON.parse(manifestText));
    } catch {
      throw new DocumentInputError("The multipart manifest is invalid.");
    }
  }

  if (manifest.length > uploadLimits.maxAssetCount) {
    throw new DocumentInputError("A document can contain at most 50 uploaded images.");
  }

  const seenPaths = new Set<string>();
  const assets: UploadedAsset[] = [];
  let totalBytes = documentFile.size;

  for (const item of manifest) {
    const path = normalizeAssetPath(item.path);
    if (seenPaths.has(path)) {
      throw new DocumentInputError(`Duplicate asset path: ${path}`);
    }
    seenPaths.add(path);

    const value = formData.get(item.field);
    if (!(value instanceof File)) {
      throw new DocumentInputError(`Missing uploaded asset for: ${path}`);
    }
    if (value.size > uploadLimits.maxAssetBytes) {
      throw new DocumentInputError(`Asset exceeds the 4 MB limit: ${path}`);
    }

    const mimeType = inferImageMimeType(value, path);
    if (!allowedImageTypes.has(mimeType)) {
      throw new DocumentInputError(`Unsupported image type: ${path}`);
    }

    const bytes = await value.arrayBuffer();
    assets.push({
      path,
      mimeType,
      sizeBytes: value.size,
      bytes,
    });
    totalBytes += value.size;
  }

  if (totalBytes > uploadLimits.maxRequestBytes) {
    throw new DocumentInputError("The document bundle is larger than the 5 MB limit.");
  }

  const source = await documentFile.text();
  const titleValue = formData.get("title");
  const pathValue = formData.get("path");
  let path: string | undefined;
  if (pathValue !== null) {
    if (typeof pathValue !== "string") {
      throw new DocumentInputError("The document path must be a string.");
    }
    if (pathValue.trim()) {
      try {
        path = normalizeDocumentPath(pathValue);
      } catch (error) {
        if (error instanceof DocumentPathError) {
          throw new DocumentInputError(error.message);
        }
        throw error;
      }
    }
  }

  if (path === undefined) {
    try {
      documentPathFromFilename(filename);
    } catch (error) {
      if (error instanceof DocumentPathError) {
        throw new DocumentInputError(error.message);
      }
      throw error;
    }
  }

  return {
    filename,
    path,
    title:
      typeof titleValue === "string" && titleValue.trim()
        ? normalizeDocumentTitle(titleValue)
        : titleFromFilename(filename),
    format,
    source,
    sourceBytes: new TextEncoder().encode(source).byteLength,
    assets,
  };
}
