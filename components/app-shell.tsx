"use client";

import { usePathname } from "next/navigation";
import { LibraryBig, Settings } from "lucide-react";

import { AppSidebar } from "@/components/app-sidebar";
import { DocumentBreadcrumb } from "@/components/document-breadcrumb";
import { ThemeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import type { DocumentTreePage } from "@/lib/documents/service";
import { DocumentTreeProvider, useDocumentTree } from "@/lib/hooks/use-document-tree";

function SectionHeader({ pathname }: { pathname: string }) {
  const tree = useDocumentTree();

  if (pathname.startsWith("/settings")) {
    return (
      <div className="flex items-center gap-2 text-xs font-medium text-foreground">
        <Settings className="size-3.5 text-muted-foreground" />
        <span>Settings</span>
      </div>
    );
  }
  if (pathname.startsWith("/documents/")) {
    return <DocumentBreadcrumb path={tree.activeDocumentPath} />;
  }
  return (
    <div className="flex items-center gap-2 text-xs font-medium text-foreground">
      <LibraryBig className="size-3.5 text-muted-foreground" />
      <span>Library</span>
    </div>
  );
}

export function AppShell({
  user,
  initialTree,
  children,
}: {
  user: { name: string; email: string; image?: string | null };
  initialTree: DocumentTreePage;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <DocumentTreeProvider initialPage={initialTree}>
      <SidebarProvider>
        <AppSidebar user={user} />

        <SidebarInset className="bg-background flex flex-col min-h-screen">
          <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center justify-between border-b border-border/80 bg-background px-4">
            <div className="flex items-center gap-2.5">
              <SidebarTrigger className="-ml-1 text-muted-foreground hover:text-foreground" />
              <Separator orientation="vertical" className="mr-1 h-4" />
              <SectionHeader pathname={pathname} />
            </div>

            <div className="flex items-center">
              <ThemeToggle />
            </div>
          </header>

          <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-6 sm:px-6 md:px-8">
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </DocumentTreeProvider>
  );
}
