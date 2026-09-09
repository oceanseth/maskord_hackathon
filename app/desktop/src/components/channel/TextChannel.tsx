import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useAuth, useGuildMembers, useGuildChannels, useMessages, useUserProfiles, sendMessage, deleteMessage, editMessage } from '@maskord/shared';
import type { Message } from '@maskord/shared';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { formatDistanceToNow } from 'date-fns';
import UserProfilePopover from '../ui/UserProfilePopover';
import MessageAttachments from './MessageAttachments';
import { uploadAttachment } from '../../lib/convexUploads';

interface Props {
  guildId: string;
  channelId: string;
}

export default function TextChannel({ guildId, channelId }: Props) {
  const { firebaseUser } = useAuth();
  const channels = useGuildChannels(guildId);
  const channelName = channels.find((c) => c.id === channelId)?.name ?? '';
  const { messages, loading, hasMore, loadMore } = useMessages(guildId, channelId);
  const members = useGuildMembers(guildId);
  const [input, setInput] = useState('');
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Profile popover state
  const [profilePopover, setProfilePopover] = useState<{
    userId: string;
    anchorRect: DOMRect;
  } | null>(null);

  // Collect unique author IDs so we can fetch their profiles
  const authorIds = useMemo(
    () => [...new Set(messages.map((m) => m.authorId))],
    [messages],
  );
  const userProfiles = useUserProfiles(authorIds);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > 0) {
      virtuosoRef.current?.scrollToIndex({ index: messages.length - 1, behavior: 'smooth' });
    }
  }, [messages.length]);

  const getMemberInfo = useCallback(
    (userId: string) => {
      const member = members.find((m) => m.userId === userId);
      const profile = userProfiles[userId];
      const name = member?.nickname ?? profile?.displayName ?? userId.split(':').pop() ?? 'Unknown';
      const avatarUrl = profile?.avatarUrl ?? '';
      return { name, avatarUrl };
    },
    [members, userProfiles],
  );

  function handleUserClick(userId: string, e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setProfilePopover({ userId, anchorRect: rect });
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const content = input.trim();
    if (!content || !firebaseUser) return;
    setInput('');
    await sendMessage(guildId, channelId, firebaseUser.uid, content);
  }

  /**
   * Files go straight to Convex storage; the message that carries them stays in
   * Firestore. Firestore rules reject an empty message body, so an attachment
   * sent on its own is captioned with its filename.
   */
  const sendFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!firebaseUser) return;
      setUploadError(null);

      for (const file of Array.from(files)) {
        setUploading(file.name);
        try {
          const attachment = await uploadAttachment(file);
          const caption = input.trim();
          if (caption) setInput('');
          await sendMessage(
            guildId,
            channelId,
            firebaseUser.uid,
            caption || file.name,
            [attachment],
          );
        } catch (err) {
          setUploadError(err instanceof Error ? err.message : 'Upload failed');
        } finally {
          setUploading(null);
        }
      }
    },
    [firebaseUser, guildId, channelId, input],
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e as unknown as React.FormEvent);
    }
  }

  async function handleEdit(msg: Message) {
    if (editContent.trim() === msg.content) { setEditingId(null); return; }
    await editMessage(guildId, channelId, msg.id, editContent.trim());
    setEditingId(null);
  }

  const dragDepth = useRef(0);
  const hasFiles = (e: React.DragEvent) => e.dataTransfer?.types.includes('Files');

  return (
    <div className="flex-1 flex min-h-0 bg-[#0e0e16]">
      {/* Message area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Channel header */}
        <div className="h-12 flex items-center gap-2 px-4 border-b border-[#1e1e2e] flex-shrink-0">
          <span className="text-[#6b7280] text-lg">#</span>
          <span className="font-semibold text-white text-sm">{channelName}</span>
        </div>

        {/* Messages — the drop target for file sharing */}
        <div
          className="relative flex-1 min-h-0"
          onDragEnter={(e) => {
            if (!hasFiles(e)) return;
            dragDepth.current += 1;
            setDragging(true);
          }}
          onDragOver={(e) => {
            if (hasFiles(e)) e.preventDefault();
          }}
          onDragLeave={(e) => {
            if (!hasFiles(e)) return;
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0) setDragging(false);
          }}
          onDrop={(e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            dragDepth.current = 0;
            setDragging(false);
            if (e.dataTransfer.files.length) void sendFiles(e.dataTransfer.files);
          }}
        >
          {dragging && (
            <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#0e0e16]/85 backdrop-blur-sm pointer-events-none">
              <div className="px-10 py-8 rounded-2xl border-2 border-dashed border-violet-500 text-center">
                <p className="text-white font-semibold text-xl">Drop to share in #{channelName}</p>
                <p className="text-[#94a3b8] text-sm mt-2">
                  Images and video play inline. Anything else becomes a download.
                </p>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center h-full text-[#6b7280] text-sm">
              Loading messages...
            </div>
          ) : (
            <Virtuoso
              ref={virtuosoRef}
              data={messages}
              startReached={hasMore ? loadMore : undefined}
              followOutput="smooth"
              itemContent={(_, msg) => (
                <MessageRow
                  key={msg.id}
                  message={msg}
                  currentUserId={firebaseUser?.uid}
                  getMemberInfo={getMemberInfo}
                  isEditing={editingId === msg.id}
                  editContent={editContent}
                  onStartEdit={() => { setEditingId(msg.id); setEditContent(msg.content); }}
                  onEditChange={setEditContent}
                  onEditSubmit={() => handleEdit(msg)}
                  onEditCancel={() => setEditingId(null)}
                  onDelete={() => deleteMessage(guildId, channelId, msg.id)}
                  onUserClick={handleUserClick}
                />
              )}
              components={{
                Header: () => (
                  <div className="text-center py-8 text-[#6b7280] text-sm">
                    {hasMore ? 'Loading older messages...' : 'Beginning of channel'}
                  </div>
                ),
              }}
            />
          )}
        </div>

        {/* Message input */}
        <div className="px-4 pb-4 flex-shrink-0">
          {uploadError && (
            <p className="mb-2 text-xs text-red-400">{uploadError}</p>
          )}
          {uploading && (
            <p className="mb-2 text-xs text-[#6b7280]">Uploading {uploading}…</p>
          )}
          <form onSubmit={handleSend}>
            <div className="flex items-end gap-3 bg-[#1a1a28] rounded-xl px-4 py-3 border border-[#2a2a40]">
              <button
                type="button"
                title="Attach a file"
                onClick={() => fileInputRef.current?.click()}
                className="w-8 h-8 rounded-lg hover:bg-[#2a2a40] text-[#6b7280] hover:text-white flex items-center justify-center transition-colors flex-shrink-0"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                  <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                </svg>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) void sendFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Send a message..."
                rows={1}
                className="flex-1 bg-transparent text-white text-sm outline-none resize-none placeholder:text-[#6b7280] selectable"
                style={{ maxHeight: '200px' }}
              />
              <button
                type="submit"
                disabled={!input.trim()}
                className="w-8 h-8 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-30 flex items-center justify-center transition-colors flex-shrink-0"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* User profile popover */}
      {profilePopover && firebaseUser && (
        <UserProfilePopover
          userId={profilePopover.userId}
          viewerUid={firebaseUser.uid}
          guildId={guildId}
          anchorRect={profilePopover.anchorRect}
          onClose={() => setProfilePopover(null)}
        />
      )}
    </div>
  );
}

// ─── Message Row ──────────────────────────────────────────────────────────────

interface MessageRowProps {
  message: Message;
  currentUserId?: string;
  getMemberInfo: (uid: string) => { name: string; avatarUrl: string };
  isEditing: boolean;
  editContent: string;
  onStartEdit: () => void;
  onEditChange: (v: string) => void;
  onEditSubmit: () => void;
  onEditCancel: () => void;
  onDelete: () => void;
  onUserClick: (userId: string, e: React.MouseEvent) => void;
}

function MessageRow({
  message,
  currentUserId,
  getMemberInfo,
  isEditing,
  editContent,
  onStartEdit,
  onEditChange,
  onEditSubmit,
  onEditCancel,
  onDelete,
  onUserClick,
}: MessageRowProps) {
  const isOwn = message.authorId === currentUserId;
  const { name, avatarUrl } = getMemberInfo(message.authorId);
  const initials = name.substring(0, 2).toUpperCase();
  const time = message.createdAt
    ? formatDistanceToNow(message.createdAt.toDate(), { addSuffix: true })
    : '';

  if (message.type === 'system_join') {
    return (
      <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-[#6b7280]">
        <span>👋</span>
        <span><span className="text-violet-400 font-medium">{name}</span> joined the server.</span>
      </div>
    );
  }

  return (
    <div className="group flex gap-3 px-4 py-1 hover:bg-[#1a1a28]/40 transition-colors">
      {/* Avatar — clickable */}
      <button
        onClick={(e) => onUserClick(message.authorId, e)}
        className="w-10 h-10 rounded-full bg-violet-600/30 flex items-center justify-center flex-shrink-0 mt-0.5 overflow-hidden hover:opacity-80 transition-opacity cursor-pointer"
        title={`View ${name}'s profile`}
      >
        {avatarUrl
          ? <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
          : <span className="text-xs font-bold text-violet-300">{initials}</span>
        }
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5">
          {/* Username — clickable */}
          <button
            onClick={(e) => onUserClick(message.authorId, e)}
            className="font-semibold text-sm text-white hover:underline cursor-pointer"
            title={`View ${name}'s profile`}
          >
            {name}
          </button>
          <span className="text-[10px] text-[#4b5563]">{time}</span>
          {message.editedAt && (
            <span className="text-[10px] text-[#4b5563]">(edited)</span>
          )}
        </div>

        {isEditing ? (
          <div>
            <textarea
              value={editContent}
              onChange={(e) => onEditChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEditSubmit(); }
                if (e.key === 'Escape') onEditCancel();
              }}
              autoFocus
              className="w-full bg-[#1a1a28] border border-violet-700/50 rounded-lg px-3 py-2 text-sm text-white outline-none resize-none selectable"
              rows={2}
            />
            <div className="flex gap-2 mt-1 text-xs">
              <button onClick={onEditSubmit} className="text-violet-400 hover:text-violet-300">Save</button>
              <span className="text-[#4b5563]">·</span>
              <button onClick={onEditCancel} className="text-[#6b7280] hover:text-white">Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-[#d4d8e0] whitespace-pre-wrap break-words selectable leading-relaxed">
              {message.content}
            </p>
            <MessageAttachments attachments={message.attachments} />
          </>
        )}

        {/* Reactions */}
        {Object.entries(message.reactions).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {Object.entries(message.reactions).map(([emoji, data]) => (
              <span
                key={emoji}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#1e1e2e] border border-[#2a2a40] text-xs"
              >
                {emoji} <span className="text-[#94a3b8]">{data.count}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Context actions */}
      {isOwn && !isEditing && (
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
          <ActionButton title="Edit" onClick={onStartEdit}>
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
            </svg>
          </ActionButton>
          <ActionButton title="Delete" onClick={onDelete} danger>
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
            </svg>
          </ActionButton>
        </div>
      )}
    </div>
  );
}

function ActionButton({ children, title, onClick, danger }: { children: React.ReactNode; title: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${danger ? 'hover:bg-red-900/40 text-[#6b7280] hover:text-red-400' : 'hover:bg-[#1e1e2e] text-[#6b7280] hover:text-white'}`}
    >
      {children}
    </button>
  );
}
