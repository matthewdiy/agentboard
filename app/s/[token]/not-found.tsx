import { ShareUnavailable } from "@/components/share-unavailable";

/**
 * The 404 boundary for the public share route. A token that never existed is
 * reported as a missing link, and never reaches the dashboard's not-found page.
 */
export default function SharedDocumentNotFound() {
  return <ShareUnavailable reason="missing" />;
}
