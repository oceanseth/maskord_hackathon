import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConvexProvider, useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import Attachment from './Attachment';
import {
  convex,
  formatBytes,
  getDisplayName,
  getSessionId,
  setDisplayName,
} from './session';

const CHANNEL = 'hackathon';
const HEARTBEAT_MS = 10_000;
const MAX_BYTES = 100 * 1024 * 1024;

export default function ChannelPage() {
  return (
    <ConvexProvider client={convex}>
      <Channel />
    </ConvexProvider>
  );
}

function Channel() {
  const sessionId = useMemo(getSessionId, []);
  const [name, setName] = useState(getDisplayName);

  const messages = useQuery(api.messages.list, { channel: CHANNEL });
  const present = useQuery(api.presence.list, { channel: CHANNEL });
  const send = useMutation(api.messages.send);
  const generateUploadUrl = useMutation(api.messages.generateUploadUrl);
  const heartbeat = useMutation(api.presence.heartbeat);

  const [draft, setDraft] = useState('');
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = 'Maskord — live channel';
  }, []);

  // Presence heartbeat. Convex has no onDisconnect, so a session simply stops
  // checking in and readers age it out.
  useEffect(() => {
    const beat = () => void heartbeat({ channel: CHANNEL, sessionId, name });
    beat();
    const id = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [heartbeat, sessionId, name]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages?.length]);

  const upload = useCallback(
    async (files: FileList | File[]) => {
      setError(null);
      for (const file of Array.from(files)) {
        if (file.size > MAX_BYTES) {
          setError(`${file.name} is ${formatBytes(file.size)} — the limit is 100 MB`);
          continue;
        }
        setUploading(file.name);
        try {
          const url = await generateUploadUrl();
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': file.type || 'application/octet-stream' },
            body: file,
          });
          if (!res.ok) throw new Error(`upload failed (${res.status})`);
          const { storageId } = (await res.json()) as { storageId: string };

          await send({
            channel: CHANNEL,
            author: name,
            body: '',
            attachment: {
              storageId: storageId as never,
              name: file.name,
              type: file.type || 'application/octet-stream',
              size: file.size,
            },
          });
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Upload failed');
        } finally {
          setUploading(null);
        }
      }
    },
    [generateUploadUrl, send, name],
  );

  // Whole-window drop target, so a file can be dropped anywhere in the channel.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files');

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth += 1;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (e.dataTransfer?.files.length) void upload(e.dataTransfer.files);
    };

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [upload]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    setError(null);
    try {
      await send({ channel: CHANNEL, author: name, body });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send');
      setDraft(body);
    }
  };

  const renameSelf = () => {
    const next = window.prompt('Display name', name)?.trim();
    if (!next) return;
    setDisplayName(next);
    setName(next);
  };

  return (
    <div className="min-h-screen flex flex-col bg-maskord-dark text-maskord-text">
      <header className="shrink-0 glass border-b border-maskord-border">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <a href="/" className="font-display font-bold text-lg hover:text-violet-300 transition-colors">
              Maskord
            </a>
            <span className="ml-3 font-mono text-xs text-maskord-muted">#{CHANNEL}</span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden sm:flex items-center gap-2 font-mono text-xs text-maskord-muted">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              {present?.length ?? 0} here
            </span>
            <button
              onClick={renameSelf}
              className="px-3 py-1.5 rounded-lg border border-maskord-border hover:border-violet-700/60 text-xs font-mono transition-colors"
            >
              {name}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-8">
          {messages === undefined && (
            <p className="text-maskord-muted text-sm font-mono">connecting to Convex…</p>
          )}

          {messages?.length === 0 && (
            <div className="text-center py-20">
              <p className="text-maskord-subtle">Nothing here yet.</p>
              <p className="text-maskord-muted text-sm mt-2">
                Drop a file anywhere on this page, or say something.
              </p>
            </div>
          )}

          <ul className="space-y-5">
            {messages?.map((m) => (
              <li key={m._id} className="flex gap-4">
                <Avatar name={m.author} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-3">
                    <span className="font-medium text-sm">{m.author}</span>
                    <time className="font-mono text-xs text-maskord-muted">
                      {new Date(m._creationTime).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </div>
                  {m.body && (
                    <p className="text-maskord-subtle whitespace-pre-wrap break-words mt-0.5">
                      {m.body}
                    </p>
                  )}
                  {m.attachment && <Attachment attachment={m.attachment} />}
                </div>
              </li>
            ))}
          </ul>
          <div ref={bottom} />
        </div>
      </main>

      <footer className="shrink-0 border-t border-maskord-border bg-maskord-darker">
        <div className="max-w-4xl mx-auto px-6 py-4">
          {error && <p className="mb-2 text-sm text-rose-400">{error}</p>}
          {uploading && (
            <p className="mb-2 text-sm text-maskord-muted font-mono">uploading {uploading}…</p>
          )}

          <form onSubmit={submit} className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              aria-label="Attach a file"
              className="shrink-0 w-10 h-10 rounded-xl border border-maskord-border hover:border-violet-700/60 flex items-center justify-center text-maskord-subtle transition-colors"
            >
              +
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void upload(e.target.files);
                e.target.value = '';
              }}
            />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={`Message #${CHANNEL} — or drop a file`}
              className="flex-1 px-4 py-3 rounded-xl bg-maskord-surface border border-maskord-border focus:border-violet-700/60 focus:outline-none placeholder:text-maskord-muted"
            />
            <button
              type="submit"
              className="shrink-0 px-5 py-3 rounded-xl bg-maskord-accent hover:bg-violet-500 text-white font-medium transition-colors disabled:opacity-40"
              disabled={!draft.trim()}
            >
              Send
            </button>
          </form>
        </div>
      </footer>

      {dragging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-maskord-darker/80 backdrop-blur-sm pointer-events-none">
          <div className="px-10 py-8 rounded-2xl border-2 border-dashed border-violet-500 text-center">
            <p className="font-display font-bold text-2xl">Drop to share</p>
            <p className="text-maskord-subtle text-sm mt-2">
              Images and video play inline. Anything else becomes a download.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  const hue = Array.from(name).reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <div
      className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center font-display font-bold text-sm text-white"
      style={{ backgroundColor: `hsl(${hue} 45% 38%)` }}
      aria-hidden
    >
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}
