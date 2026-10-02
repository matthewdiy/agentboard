import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicDocumentView } from "@/components/public-document-view";
import { ShareUnavailable } from "@/components/share-unavailable";
import {
  getSharedDocument,
  getShareByToken,
  recordShareAccess,
} from "@/lib/documents/service";

// The page is rendered per request: expiry and revocation are decided at
// request time, and Next's dynamic Cache-Control keeps a CDN from holding a
// copy that outlives the link.
export const dynamic = "force-dynamic";

// React's cache memoizes these across generateMetadata and the page within one
// request, so an active link costs one look-up and one document read.
const loadShare = cache(async (token: string) => getShareByToken(token));
const loadSharedDocument = cache(async (nodeId: string) =>
  getSharedDocument(nodeId),
);

type PageProps = { params: Promise<{ token: string }> };

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { token } = await params;
  const lookup = await loadShare(token);
  const document =
    lookup?.kind === "active"
      ? await loadSharedDocument(lookup.nodeId)
      : null;

  return {
    title: document ? document.title : "Link unavailable",
    // A bearer link must never be indexed, whether or not it is still live.
    robots: { index: false, follow: false },
  };
}

export default async function SharedDocumentPage({ params }: PageProps) {
  const { token } = await params;
  const lookup = await loadShare(token);

  // A token that does not exist gets a real 404 rather than a page that
  // confirms the difference between "never existed" and "expired".
  if (!lookup) notFound();

  if (lookup.kind !== "active") {
    return (
      <ShareUnavailable reason={lookup.kind} expiresAt={lookup.share.expiresAt} />
    );
  }

  const document = await loadSharedDocument(lookup.nodeId);
  if (!document) notFound();

  // Only a link that actually renders a document counts as a view.
  await recordShareAccess(lookup.share.id);

  return (
    <PublicDocumentView document={document} expiresAt={lookup.share.expiresAt} />
  );
}
