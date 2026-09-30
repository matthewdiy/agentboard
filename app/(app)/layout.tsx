import { AppShell } from "@/components/app-shell";
import { requireSession } from "@/lib/auth-guard";
import { getDocumentTree } from "@/lib/documents/service";

export const dynamic = "force-dynamic";

/**
 * Every authenticated route shares one shell, so the sidebar tree is fetched
 * and expanded once per session rather than once per page.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const initialTree = await getDocumentTree("/");

  return (
    <AppShell user={session.user} initialTree={initialTree}>
      {children}
    </AppShell>
  );
}
