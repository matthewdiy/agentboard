import { notFound } from "next/navigation";

import { DocumentDetail } from "@/components/document-detail";
import { DocumentTreeFocus } from "@/components/document-tree-focus";
import { getDocument } from "@/lib/documents/service";

export const dynamic = "force-dynamic";

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const document = await getDocument(id);
  if (!document) notFound();

  return (
    <>
      <DocumentTreeFocus path={document.path} />
      <DocumentDetail document={document} />
    </>
  );
}
