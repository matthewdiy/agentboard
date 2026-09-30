import { LibraryOverview } from "@/components/library-overview";
import { getDocumentStats, listDocuments } from "@/lib/documents/service";

export const dynamic = "force-dynamic";

const recentCount = 8;

export default async function DocumentsPage() {
  const [stats, recent] = await Promise.all([
    getDocumentStats(),
    listDocuments({ limit: recentCount }),
  ]);

  return <LibraryOverview stats={stats} recent={recent.documents} />;
}
