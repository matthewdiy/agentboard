"use client";

import { Folder, LibraryBig } from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useDocumentTree } from "@/lib/hooks/use-document-tree";

/**
 * Folders in the path expand the sidebar tree instead of navigating, so a
 * document is one click away from its neighbours without leaving the page.
 */
export function DocumentBreadcrumb({ path }: { path?: string | null }) {
  const tree = useDocumentTree();

  if (!path) {
    return (
      <Breadcrumb>
        <BreadcrumbList className="font-mono text-xs flex-wrap">
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link
                href="/documents"
                className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <LibraryBig className="size-3.5" />
                <span className="font-sans">Library</span>
              </Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage className="font-medium text-foreground">
              Document
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  const segments = path.split("/").filter(Boolean);
  const folders = segments.slice(0, -1);
  const filename = segments[segments.length - 1] ?? path;

  return (
    <Breadcrumb>
      <BreadcrumbList className="font-mono text-xs flex-wrap">
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link
              href="/documents"
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <LibraryBig className="size-3.5" />
              <span className="font-sans">Library</span>
            </Link>
          </BreadcrumbLink>
        </BreadcrumbItem>

        <BreadcrumbSeparator />

        {folders.map((segment, index) => {
          const folderPath = `/${folders.slice(0, index + 1).join("/")}`;
          return (
            <Fragment key={folderPath}>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <button
                    type="button"
                    onClick={() => tree.expandDirectory(folderPath)}
                    className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  >
                    <Folder className="size-3 text-muted-foreground/70" />
                    <span>{segment}</span>
                  </button>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
            </Fragment>
          );
        })}

        <BreadcrumbItem>
          <BreadcrumbPage className="font-medium text-foreground max-w-[200px] sm:max-w-xs truncate" title={filename}>
            {filename}
          </BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
