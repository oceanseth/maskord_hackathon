import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import type { Attachment } from '@maskord/shared';

/**
 * File attachments live in Convex storage while messages stay in Firestore.
 * The browser POSTs bytes straight to Convex, so nothing large passes through
 * Firebase, and the resolved URL is stored on the Firestore message.
 */
const CONVEX_URL =
  (import.meta as { env?: Record<string, string> }).env?.VITE_CONVEX_URL ??
  'https://impressive-skunk-614.convex.cloud';

export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

const generateUploadUrl = makeFunctionReference<'mutation', Record<string, never>, string>(
  'messages:generateUploadUrl',
);
const getUrl = makeFunctionReference<'query', { storageId: string }, string | null>('files:getUrl');

let client: ConvexHttpClient | null = null;
function convex() {
  if (!client) client = new ConvexHttpClient(CONVEX_URL);
  return client;
}

export async function uploadAttachment(file: File): Promise<Attachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${file.name} is larger than 100 MB`);
  }

  const uploadUrl = await convex().mutation(generateUploadUrl, {});

  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);

  const { storageId } = (await res.json()) as { storageId: string };
  const url = await convex().query(getUrl, { storageId });
  if (!url) throw new Error('Convex returned no URL for the upload');

  return {
    url,
    filename: file.name,
    size: file.size,
    contentType: file.type || 'application/octet-stream',
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
