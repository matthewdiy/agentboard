import { randomUUID } from "node:crypto";

import { documentAssets } from "@/db/schema";
import { deleteAsset, putAsset } from "@/lib/blob-store";
import { getAppUrl } from "@/lib/env";
import type { ParsedDocumentUpload } from "./processing";
import type { Transaction } from "./types";

export type AssetReference = ReturnType<typeof buildAssetReferences>[number];

export function buildAssetReferences(
  documentId: string,
  upload: ParsedDocumentUpload,
) {
  return upload.assets.map((asset) => {
    const id = randomUUID();
    return {
      id,
      sourcePath: asset.path,
      publicUrl: `${getAppUrl()}/assets/${id}`,
      blobKey: `documents/${documentId}/${id}`,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      bytes: asset.bytes,
    };
  });
}

export async function writeBlobs(assets: AssetReference[]) {
  await Promise.all(
    assets.map((asset) => putAsset(asset.blobKey, asset.bytes, asset.mimeType)),
  );
}

export async function cleanupBlobs(assets: Array<{ blobKey: string }>) {
  // Blob storage is outside the database transaction; cleanup is best-effort
  // when a database write fails or a document is removed.
  await Promise.allSettled(assets.map((asset) => deleteAsset(asset.blobKey)));
}

export async function insertAssets(
  tx: Transaction,
  nodeId: string,
  assets: AssetReference[],
) {
  if (assets.length === 0) return;

  await tx.insert(documentAssets).values(
    assets.map((asset) => ({
      id: asset.id,
      nodeId,
      sourcePath: asset.sourcePath,
      blobKey: asset.blobKey,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
    })),
  );
}
