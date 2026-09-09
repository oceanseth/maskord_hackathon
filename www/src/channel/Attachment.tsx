import { formatBytes } from './session';

export type AttachmentData = {
  url: string | null;
  name: string;
  type: string;
  size: number;
};

/**
 * Images render inline, video and audio get native controls (click to play),
 * and anything else falls back to a download card.
 */
export default function Attachment({ attachment }: { attachment: AttachmentData }) {
  const { url, name, type, size } = attachment;

  if (!url) {
    return (
      <div className="mt-2 text-xs text-maskord-muted font-mono">
        {name} — file is still uploading
      </div>
    );
  }

  if (type.startsWith('image/')) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block mt-2 w-fit">
        <img
          src={url}
          alt={name}
          loading="lazy"
          className="max-h-80 max-w-full rounded-xl border border-maskord-border"
        />
      </a>
    );
  }

  if (type.startsWith('video/')) {
    return (
      <video
        src={url}
        controls
        preload="metadata"
        className="mt-2 max-h-80 max-w-full rounded-xl border border-maskord-border bg-black"
      />
    );
  }

  if (type.startsWith('audio/')) {
    return <audio src={url} controls preload="metadata" className="mt-2 w-full max-w-md" />;
  }

  return (
    <a
      href={url}
      download={name}
      className="mt-2 inline-flex items-center gap-3 px-4 py-3 rounded-xl bg-maskord-darker border border-maskord-border hover:border-violet-700/60 transition-colors max-w-md"
    >
      <FileIcon className="w-6 h-6 text-maskord-subtle shrink-0" />
      <span className="min-w-0">
        <span className="block text-sm text-maskord-text truncate">{name}</span>
        <span className="block text-xs text-maskord-muted font-mono">
          {formatBytes(size)} · download
        </span>
      </span>
    </a>
  );
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M14 2H6.5A1.5 1.5 0 0 0 5 3.5v17A1.5 1.5 0 0 0 6.5 22h11a1.5 1.5 0 0 0 1.5-1.5V7l-5-5z" strokeLinejoin="round" />
      <path d="M14 2v5h5" strokeLinejoin="round" />
    </svg>
  );
}
