"use client";

import {
  ChevronsUpDown,
  LibraryBig,
  LogOut,
  Plus,
  Settings,
  Shield,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { AppLogo } from "@/components/app-logo";
import { DocumentTreePanel } from "@/components/document-tree-panel";
import { NewDocumentDialog } from "@/components/new-document-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";

export function AppSidebar({
  user,
}: {
  user: { name: string; email: string; image?: string | null };
}) {
  const pathname = usePathname();
  const router = useRouter();
  const initials = (user.name || user.email).slice(0, 2).toUpperCase();

  const isActive = (href: string) =>
    pathname === href || (href !== "/documents" && pathname.startsWith(`${href}/`));

  const isLibraryActive = pathname === "/documents";

  async function signOut() {
    await authClient.signOut();
    router.push("/login");
  }

  return (
    <Sidebar className="border-r border-sidebar-border bg-sidebar">
      <SidebarHeader className="border-b border-sidebar-border/70 pb-3 pt-3">
        <div className="flex items-center justify-between gap-1">
          <Link
            href="/documents"
            className="flex min-w-0 items-center gap-2.5 rounded-md px-1.5 py-1 transition-colors hover:bg-sidebar-accent/60"
          >
            <AppLogo className="size-6.5" />
            <span className="truncate text-sm font-semibold tracking-tight text-foreground">
              Agentboard
            </span>
          </Link>

          <NewDocumentDialog
            trigger={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="New document"
                className="hover:bg-sidebar-accent text-muted-foreground hover:text-foreground"
              >
                <Plus className="size-4" />
              </Button>
            }
          />
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0 overflow-hidden">
        <SidebarGroup className="py-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                size="sm"
                isActive={isLibraryActive}
                className="py-1.5 font-medium"
              >
                <Link href="/documents">
                  <LibraryBig className={isLibraryActive ? "text-primary" : "text-muted-foreground"} />
                  <span>Library</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        <SidebarSeparator className="my-1 opacity-60" />

        <DocumentTreePanel />
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/70 pt-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              size="sm"
              isActive={isActive("/settings")}
              className="py-1.5"
            >
              <Link href="/settings">
                <Settings className={isActive("/settings") ? "text-primary" : "text-muted-foreground"} />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="mt-1 hover:bg-sidebar-accent/70 rounded-md p-1.5 transition-colors data-[state=open]:bg-sidebar-accent"
                >
                  <Avatar className="size-6.5 rounded-md">
                    {user.image ? (
                      <AvatarImage
                        src={user.image}
                        alt={user.name || "User profile image"}
                        referrerPolicy="no-referrer"
                        className="rounded-md object-cover"
                      />
                    ) : null}
                    <AvatarFallback className="rounded-md bg-muted text-foreground text-[11px] font-medium border border-border/80">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="grid min-w-0 flex-1 text-left leading-tight">
                    <span className="truncate text-xs font-medium text-foreground">{user.name}</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {user.email}
                    </span>
                  </span>
                  <ChevronsUpDown className="ml-auto size-3.5 text-muted-foreground/70" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>

              <DropdownMenuContent
                side="top"
                align="start"
                className="w-56 rounded-lg p-1 shadow-md border-border/80"
              >
                <DropdownMenuLabel className="font-normal px-2 py-1.5">
                  <div className="flex items-center gap-2.5">
                    <Avatar className="size-8 rounded-md shrink-0">
                      {user.image ? (
                        <AvatarImage
                          src={user.image}
                          alt={user.name || "User profile image"}
                          referrerPolicy="no-referrer"
                          className="rounded-md object-cover"
                        />
                      ) : null}
                      <AvatarFallback className="rounded-md bg-muted text-foreground text-xs font-medium border border-border/80">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col space-y-0.5 min-w-0">
                      <span className="truncate text-xs font-semibold">{user.name}</span>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {user.email}
                      </span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/settings" className="cursor-pointer gap-2 text-xs">
                    <Shield className="size-3.5 text-muted-foreground" />
                    <span>API Keys</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => void signOut()}
                  className="cursor-pointer gap-2 text-xs"
                >
                  <LogOut className="size-3.5" />
                  <span>Sign out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
