import { getStore } from "@netlify/blobs";

const ASSET_STORE_NAME = process.env.NETLIFY_BLOBS_STORE ?? "agentboard-assets";

export function getAssetStore() {
  return getStore(ASSET_STORE_NAME);
}

export async function putAsset(
  key: string,
  bytes: ArrayBuffer,
  contentType: string,
) {
  await getAssetStore().set(key, bytes, {
    metadata: {
      contentType,
    },
  });
}

export async function deleteAsset(key: string) {
  await getAssetStore().delete(key);
}
