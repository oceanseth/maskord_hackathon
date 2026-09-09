import type { Attachment } from '@maskord/shared';
import { formatBytes } from '../../lib/convexUploads';

/**
 * Attachments are stored in Convex and rendered by kind: images inline, video
 * and audio with native controls, anything else as a download.
 */
export default function MessageAttachments({ attachments }: { attachments?: Attachment[] }) {
  if (!attachments?.length) return null;

  return (
    <div className="mt-1.5 space-y-2">
      {attachments.map((a) => (
        <One key={a.url} attachment={a} />
      ))}
    </div>
  );
}

function One({ attachment }: { attachment: Attachment }) {
  const { url, filename, size, contentType } = attachment;

  if (contentType.startsWith('image/')) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block w-fit">
        <img
          src={url}
          alt={filename}
          loading="lazy"
          className="max-h-80 max-w-full rounded-lg border border-[#2a2a40]"
        />
      </a>
    );
  }

  if (contentType.startsWith('video/')) {
    return (
      <video
        src={url}
        controls
        preload="metadata"
        className="max-h-80 max-w-full rounded-lg border border-[#2a2a40] bg-black"
      />
    );
  }

  if (contentType.startsWith('audio/')) {
    return <audio src={url} controls preload="metadata" className="w-full max-w-md" />;
  }

  return (
    <a
      href={url}
      download={filename}
      className="inline-flex items-center gap-3 px-3 py-2 rounded-lg bg-[#1a1a28] border border-[#2a2a40] hover:border-violet-700/60 transition-colors max-w-md"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5 text-[#6b7280] flex-shrink-0">
        <path d="M14 2H6.5A1.5 1.5 0 0 0 5 3.5v17A1.5 1.5 0 0 0 6.5 22h11a1.5 1.5 0 0 0 1.5-1.5V7l-5-5z" strokeLinejoin="round" />
        <path d="M14 2v5h5" strokeLinejoin="round" />
      </svg>
      <span className="min-w-0">
        <span className="block text-sm text-white truncate">{filename}</span>
        <span className="block text-[10px] text-[#6b7280]">{formatBytes(size)} · download</span>
      </span>
    </a>
  );
}
