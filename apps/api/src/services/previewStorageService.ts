import { getSupabase } from '../db/index.js';
import { config } from '../config.js';

export interface PreviewStoredObject {
  bucket: string;
  path: string;
  mimeType: string;
}

export async function uploadPreviewObject(
  artifactId: string,
  filename: string,
  data: Buffer | string,
  mimeType: string,
): Promise<PreviewStoredObject> {
  const bucket = config.previewStorageBucket;
  const storagePath = `${artifactId}/${filename}`;

  const uploadData = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
  const { error } = await getSupabase()
    .storage
    .from(bucket)
    .upload(storagePath, uploadData, {
      contentType: mimeType,
      upsert: true,
    });

  if (error) {
    throw new Error(`Failed to upload preview artifact object: ${error.message}`);
  }

  return {
    bucket,
    path: storagePath,
    mimeType,
  };
}

export async function createPreviewSignedUrl(
  bucket: string,
  storagePath: string,
  expiresInSec: number = config.previewSignedUrlTtlSec,
): Promise<{ url: string; expiresAt: string }> {
  const { data, error } = await getSupabase()
    .storage
    .from(bucket)
    .createSignedUrl(storagePath, expiresInSec);

  if (error || !data?.signedUrl) {
    throw new Error(`Failed to create preview signed URL: ${error?.message || 'unknown error'}`);
  }

  return {
    url: data.signedUrl,
    expiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString(),
  };
}

