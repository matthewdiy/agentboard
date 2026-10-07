"use client";

import { useEffect, useId, useState } from "react";
import {
  AlertTriangle,
  Check,
  Code2,
  Copy,
  Eye,
  Maximize2,
  Workflow,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useCopyToClipboard } from "@/lib/hooks/use-copy-to-clipboard";

type MermaidCardProps = {
  code: string;
  isDark: boolean;
};

function inferDiagramType(code: string): string {
  const firstLine = code
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("%%"));

  if (!firstLine) return "Diagram";

  const lower = firstLine.toLowerCase();
  if (lower.startsWith("graph") || lower.startsWith("flowchart")) return "Flowchart";
  if (lower.startsWith("sequencediagram")) return "Sequence Diagram";
  if (lower.startsWith("classdiagram")) return "Class Diagram";
  if (lower.startsWith("statediagram")) return "State Diagram";
  if (lower.startsWith("erdiagram")) return "Entity Relationship";
  if (lower.startsWith("journey")) return "User Journey";
  if (lower.startsWith("gantt")) return "Gantt Chart";
  if (lower.startsWith("pie")) return "Pie Chart";
  if (lower.startsWith("gitgraph")) return "Git Graph";
  if (lower.startsWith("mindmap")) return "Mindmap";
  if (lower.startsWith("timeline")) return "Timeline";
  if (lower.startsWith("quadrantchart")) return "Quadrant Chart";
  if (lower.startsWith("c4")) return "C4 Diagram";
  if (lower.startsWith("architecture")) return "Architecture";

  return "Diagram";
}

export function MermaidCard({ code, isDark }: MermaidCardProps) {
  const reactId = useId().replace(/:/g, "_");
  const currentKey = `${isDark ? "dark" : "light"}:${code}`;
  const [renderState, setRenderState] = useState<{
    key: string;
    svg: string | null;
    error: string | null;
  }>({
    key: "",
    svg: null,
    error: null,
  });
  const [showCode, setShowCode] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { copiedKey, copy } = useCopyToClipboard();

  const diagramType = inferDiagramType(code);
  const isCurrent = renderState.key === currentKey;
  const loading = !isCurrent;
  const svg = isCurrent ? renderState.svg : null;
  const error = isCurrent ? renderState.error : null;

  useEffect(() => {
    let cancelled = false;

    async function renderMermaid() {
      try {
        const mermaid = (await import("mermaid")).default;

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: isDark ? "dark" : "neutral",
          fontFamily:
            "var(--font-sans), system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          themeVariables: isDark
            ? {
                darkMode: true,
                background: "transparent",
                mainBkg: "#1c2421",
                nodeBorder: "#22c55e",
                clusterBkg: "#141a18",
                clusterBorder: "#2e3b36",
                lineColor: "#94a3b8",
                textColor: "#f1f5f9",
                edgeLabelBackground: "#1c2421",
                primaryColor: "#22c55e",
                primaryTextColor: "#f1f5f9",
                primaryBorderColor: "#16a34a",
              }
            : {
                background: "transparent",
                mainBkg: "#f4fbf7",
                nodeBorder: "#16a34a",
                clusterBkg: "#f8fafc",
                clusterBorder: "#e2e8f0",
                lineColor: "#475569",
                textColor: "#0f172a",
                edgeLabelBackground: "#ffffff",
                primaryColor: "#16a34a",
                primaryTextColor: "#0f172a",
                primaryBorderColor: "#15803d",
              },
          suppressErrorRendering: true,
        });

        const uniqueId = `mermaid_${reactId}_${Math.random().toString(36).slice(2, 7)}`;
        const result = await mermaid.render(uniqueId, code);

        if (!cancelled) {
          setRenderState({
            key: currentKey,
            svg: result.svg,
            error: null,
          });
        }
      } catch (renderError) {
        if (!cancelled) {
          const message =
            renderError instanceof Error
              ? renderError.message
              : "Invalid Mermaid diagram syntax.";
          setRenderState({
            key: currentKey,
            svg: null,
            error: message,
          });
        }
      }
    }

    void renderMermaid();

    return () => {
      cancelled = true;
    };
  }, [code, isDark, reactId, currentKey]);

  return (
    <>
      <div className="mermaid-wrapper my-6 rounded-lg border border-border/80 bg-card overflow-hidden shadow-xs transition-colors">
        {/* Card Toolbar Header */}
        <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-3 py-1.5 text-xs">
          <div className="flex items-center gap-1.5">
            <Badge
              variant="outline"
              className="gap-1 px-1.5 py-0.5 text-[10px] font-medium border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
            >
              <Workflow className="size-3" />
              <span>{diagramType}</span>
            </Badge>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => void copy(code, "mermaid-code")}
              className="size-6 text-muted-foreground hover:text-foreground"
              title="Copy diagram source"
              aria-label="Copy diagram source"
            >
              {copiedKey === "mermaid-code" ? (
                <Check className="size-3 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Copy className="size-3" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setShowCode(!showCode)}
              className="size-6 text-muted-foreground hover:text-foreground"
              title={showCode ? "Show diagram" : "View source code"}
              aria-label={showCode ? "Show diagram" : "View source code"}
            >
              {showCode ? <Eye className="size-3" /> : <Code2 className="size-3" />}
            </Button>

            {!error && svg && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setExpanded(true)}
                className="size-6 text-muted-foreground hover:text-foreground"
                title="Expand diagram"
                aria-label="Expand diagram"
              >
                <Maximize2 className="size-3" />
              </Button>
            )}
          </div>
        </div>

        {/* Card Body */}
        {showCode ? (
          <pre className="p-4 text-xs font-mono bg-code-bg text-code-foreground overflow-x-auto m-0 border-0 rounded-none">
            <code>{code}</code>
          </pre>
        ) : error ? (
          <div className="p-4 space-y-3">
            <div className="flex items-start gap-2.5 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-medium">Mermaid syntax error</p>
                <p className="text-[11px] text-destructive/80 font-mono break-all">{error}</p>
              </div>
            </div>
            <pre className="p-3 text-xs font-mono bg-muted/60 text-muted-foreground rounded-md overflow-x-auto border border-border/60">
              <code>{code}</code>
            </pre>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-xs text-muted-foreground">
            <Spinner className="size-4" />
            <span>Rendering diagram…</span>
          </div>
        ) : svg ? (
          <div
            className="mermaid-diagram flex justify-center items-center p-4 sm:p-6 overflow-x-auto"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : null}
      </div>

      {/* Expand Full-Size Dialog */}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-w-5xl sm:max-w-6xl max-h-[90vh] flex flex-col p-6">
          <DialogHeader className="border-b border-border/70 pb-3">
            <div className="flex items-center justify-between pr-6">
              <div className="space-y-1">
                <DialogTitle className="text-base font-semibold flex items-center gap-2">
                  <Workflow className="size-4 text-emerald-600 dark:text-emerald-400" />
                  <span>{diagramType} Preview</span>
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Full-resolution diagram view with pan and scroll.
                </DialogDescription>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => void copy(code, "modal-code")}
                className="h-7 text-xs gap-1.5"
              >
                {copiedKey === "modal-code" ? (
                  <>
                    <Check className="size-3 text-emerald-600 dark:text-emerald-400" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="size-3" />
                    <span>Copy code</span>
                  </>
                )}
              </Button>
            </div>
          </DialogHeader>

          <div
            className="flex-1 overflow-auto p-4 sm:p-8 flex justify-center items-center bg-card rounded-md border border-border/60 min-h-[300px]"
            dangerouslySetInnerHTML={{ __html: svg || "" }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
