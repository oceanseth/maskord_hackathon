import { useState, useRef, useEffect, useMemo } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  useAuth,
  useGuild,
  useGuildChannels,
  createChannel,
  updateChannel,
  deleteChannel,
  leaveGuild,
  deleteGuild,
} from '@maskord/shared';
import type { Channel } from '@maskord/shared';
import { useAppStore } from '../../store/app';
import UserPanel from '../ui/UserPanel';
import InviteModal from '../guild/InviteModal';
import ServerSettingsModal from '../guild/ServerSettingsModal';
import CreateChannelModal from './CreateChannelModal';

interface Props { guildId: string; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a map from container ID → ordered channel IDs.
 *  containers: 'cats' (categories), 'uncat' (uncategorized), or a category ID (its children). */
function buildItems(chs: Channel[]): Record<string, string[]> {
  const sorted = (arr: Channel[]) =>
    [...arr].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((c) => c.id);

  const catIds = sorted(chs.filter((c) => c.type === 'category'));
  const uncat  = sorted(chs.filter((c) => c.type !== 'category' && !c.parentId));

  const result: Record<string, string[]> = { cats: catIds, uncat };
  for (const catId of catIds) {
    result[catId] = sorted(chs.filter((c) => c.parentId === catId && c.type !== 'category'));
  }
  return result;
}

function findContainer(id: string, m: Record<string, string[]>): string | null {
  for (const [key, arr] of Object.entries(m)) {
    if (arr.includes(id)) return key;
  }
  return null;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ChannelSidebar({ guildId }: Props) {
  const { guild }    = useGuild(guildId);
  const channels     = useGuildChannels(guildId);
  const { activeChannelId, setActiveChannel, setActiveGuild } = useAppStore();
  const { firebaseUser } = useAuth();

  const [headerMenuOpen,    setHeaderMenuOpen]    = useState(false);
  const [showInvite,        setShowInvite]        = useState(false);
  const [showSettings,      setShowSettings]      = useState(false);
  const [showCreateChannel, setShowCreateChannel] =
    useState<{ parentId?: string | null; defaultType?: 'text' | 'voice' | 'category' } | null>(null);

  const [renamingChannelId, setRenamingChannelId] = useState<string | null>(null);
  const [renameValue,       setRenameValue]       = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const [ctxMenu, setCtxMenu] = useState<{ channelId: string; x: number; y: number } | null>(null);

  // DnD state
  const [activeId, setActiveId]   = useState<string | null>(null);
  const [items, setItems]         = useState<Record<string, string[]>>(() => buildItems(channels));
  const isDragging                = useRef(false);
  const dragStartContainer        = useRef<string | null>(null);

  const channelById = useMemo(
    () => Object.fromEntries(channels.map((c) => [c.id, c])),
    [channels],
  );

  // Sync items from Firestore whenever channels change, but NOT during an active drag
  useEffect(() => {
    if (!isDragging.current) setItems(buildItems(channels));
  }, [channels]);

  // Close header menu on outside click
  const headerMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!headerMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target as Node)) {
        setHeaderMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [headerMenuOpen]);

  // Close context menu on click / scroll
  useEffect(() => {
    if (!ctxMenu) return;
    const handler = () => setCtxMenu(null);
    document.addEventListener('mousedown', handler);
    document.addEventListener('scroll', handler, true);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('scroll', handler, true);
    };
  }, [ctxMenu]);

  useEffect(() => {
    if (renamingChannelId) renameInputRef.current?.focus();
  }, [renamingChannelId]);

  const isOwner = guild?.ownerId === firebaseUser?.uid;

  // ─── Channel actions ─────────────────────────────────────────────────────────

  function handleChannelClick(channel: Channel) {
    setActiveChannel(channel.id, channel.type === 'voice' ? 'voice' : 'text');
  }

  function handleChannelRightClick(e: React.MouseEvent, channelId: string) {
    if (!isOwner) return;
    e.preventDefault();
    setCtxMenu({ channelId, x: e.clientX, y: e.clientY });
  }

  async function handleRenameSubmit(channelId: string) {
    if (!renameValue.trim()) { setRenamingChannelId(null); return; }
    await updateChannel(guildId, channelId, { name: renameValue.trim() });
    setRenamingChannelId(null);
  }

  async function handleDeleteChannel(channelId: string) {
    if (!confirm('Delete this channel? This cannot be undone.')) return;
    if (activeChannelId === channelId) setActiveChannel(null, 'text');
    await deleteChannel(guildId, channelId);
  }

  async function handleLeave() {
    if (!firebaseUser || !confirm('Leave this server?')) return;
    setActiveGuild(null);
    await leaveGuild(guildId);
  }

  async function handleDelete() {
    if (!confirm(`Delete "${guild?.name}"? This cannot be undone.`)) return;
    setActiveGuild(null);
    await deleteGuild(guildId);
  }

  // ─── DnD handlers ────────────────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function handleDragStart(e: DragStartEvent) {
    isDragging.current = true;
    const aid = e.active.id as string;
    setActiveId(aid);
    dragStartContainer.current = findContainer(aid, items);
  }

  function handleDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;

    const aid = active.id as string;
    const oid = over.id as string;

    setItems((prev) => {
      const fromContainer = findContainer(aid, prev);
      if (!fromContainer || fromContainer === 'cats') return prev; // categories sort among themselves

      let toContainer = findContainer(oid, prev);
      if (!toContainer) return prev;

      // Hovering over a category header → place channel into that category's container
      if (toContainer === 'cats') toContainer = oid;
      if (!(toContainer in prev) || fromContainer === toContainer) return prev;

      const fromItems = prev[fromContainer].filter((id) => id !== aid);
      const toItems   = [...(prev[toContainer] ?? [])];
      const overIdx   = toItems.indexOf(oid);
      const insertAt  = overIdx >= 0 ? overIdx : toItems.length;
      toItems.splice(insertAt, 0, aid);

      return { ...prev, [fromContainer]: fromItems, [toContainer]: toItems };
    });
  }

  async function handleDragEnd(e: DragEndEvent) {
    isDragging.current = false;
    const { active, over } = e;
    setActiveId(null);
    if (!over) return;

    const aid = active.id as string;
    const oid = over.id as string;

    // Same-container reorder: DragOver doesn't move items within a container, so DragEnd handles it.
    // Cross-container moves were already resolved visually in DragOver — do NOT arrayMove again.
    let finalItems = items;
    const currentContainer = findContainer(aid, items);
    if (currentContainer && currentContainer === dragStartContainer.current) {
      const arr     = items[currentContainer];
      const fromIdx = arr.indexOf(aid);
      const toIdx   = arr.indexOf(oid);
      if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
        const newOrder = arrayMove(arr, fromIdx, toIdx);
        finalItems = { ...items, [currentContainer]: newOrder };
        setItems(finalItems);
      }
    }

    dragStartContainer.current = null;
    await persistItems(finalItems);
  }

  async function persistItems(map: Record<string, string[]>) {
    const writes: Promise<void>[] = [];

    // Uncategorized channels
    (map.uncat ?? []).forEach((id, i) => {
      const ch = channelById[id];
      if (!ch) return;
      if (ch.position !== i || ch.parentId !== null) {
        writes.push(updateChannel(guildId, id, { position: i, parentId: null }));
      }
    });

    // Categories
    (map.cats ?? []).forEach((id, i) => {
      const ch = channelById[id];
      if (!ch) return;
      if (ch.position !== i) {
        writes.push(updateChannel(guildId, id, { position: i }));
      }
    });

    // Channels inside each category
    for (const catId of (map.cats ?? [])) {
      (map[catId] ?? []).forEach((id, i) => {
        const ch = channelById[id];
        if (!ch) return;
        if (ch.position !== i || ch.parentId !== catId) {
          writes.push(updateChannel(guildId, id, { position: i, parentId: catId }));
        }
      });
    }

    await Promise.all(writes);
  }

  // ─── Render helpers ──────────────────────────────────────────────────────────

  function makeChannelItemProps(ch: Channel) {
    return {
      channel:        ch,
      active:         activeChannelId === ch.id,
      renaming:       renamingChannelId === ch.id,
      renameValue,
      renameRef:      renameInputRef,
      onRenameChange: setRenameValue,
      onRenameSubmit: () => handleRenameSubmit(ch.id),
      onClick:        () => handleChannelClick(ch),
      onContextMenu:  (e: React.MouseEvent) => handleChannelRightClick(e, ch.id),
    };
  }

  const activeChannel = activeId ? channelById[activeId] : null;

  return (
    <>
      <div className="w-60 flex-shrink-0 bg-[#0e0e16] border-r border-[#1e1e2e] flex flex-col">

        {/* Guild header with dropdown */}
        <div className="relative" ref={headerMenuRef}>
          <button
            onClick={() => setHeaderMenuOpen((v) => !v)}
            className="w-full h-12 flex items-center justify-between px-4 border-b border-[#1e1e2e] drag-region hover:bg-[#1e1e2e]/50 transition-colors"
          >
            <span className="font-semibold text-white text-sm truncate no-drag">
              {guild?.name ?? '...'}
            </span>
            <svg
              width="18" height="18" viewBox="0 0 24 24" fill="currentColor"
              className={`no-drag text-[#6b7280] flex-shrink-0 transition-transform ${headerMenuOpen ? 'rotate-180' : ''}`}
            >
              <path d="M7 10l5 5 5-5z" />
            </svg>
          </button>

          {headerMenuOpen && (
            <div className="absolute top-full left-0 right-0 mx-2 mt-1 bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg shadow-2xl z-40 py-1 no-drag">
              <MenuItem label="Invite People"   icon={<InviteIcon />}     accent onClick={() => { setShowInvite(true); setHeaderMenuOpen(false); }} />
              <div className="h-px bg-[#1e1e2e] my-1" />
              <MenuItem label="Create Channel"  icon={<PlusCircleIcon />} onClick={() => { setShowCreateChannel({}); setHeaderMenuOpen(false); }} />
              <MenuItem label="Create Category" icon={<FolderIcon />}     onClick={() => { setShowCreateChannel({ defaultType: 'category' }); setHeaderMenuOpen(false); }} />
              {isOwner && (
                <MenuItem label="Server Settings" icon={<GearIcon />} onClick={() => { setShowSettings(true); setHeaderMenuOpen(false); }} />
              )}
              <div className="h-px bg-[#1e1e2e] my-1" />
              {isOwner ? (
                <MenuItem label="Delete Server" icon={<TrashIcon />} danger onClick={() => { handleDelete(); setHeaderMenuOpen(false); }} />
              ) : (
                <MenuItem label="Leave Server"  icon={<LeaveIcon />} danger onClick={() => { handleLeave(); setHeaderMenuOpen(false); }} />
              )}
            </div>
          )}
        </div>

        {/* Channel list */}
        <div className="flex-1 overflow-y-auto scrollable py-2">
          <DndContext
            sensors={isOwner ? sensors : []}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            {/* Uncategorized channels */}
            <SectionHeader onAdd={() => setShowCreateChannel({ parentId: null })} showAdd={isOwner} />
            <SortableContext items={items.uncat ?? []} strategy={verticalListSortingStrategy}>
              {(items.uncat ?? []).map((id) => {
                const ch = channelById[id];
                if (!ch) return null;
                const props = makeChannelItemProps(ch);
                return isOwner
                  ? <SortableChannelItem key={id} {...props} faded={activeId === id} />
                  : <ChannelItem         key={id} {...props} />;
              })}
            </SortableContext>

            {/* Categories + their children */}
            <SortableContext items={items.cats ?? []} strategy={verticalListSortingStrategy}>
              {(items.cats ?? []).map((catId) => {
                const cat = channelById[catId];
                if (!cat) return null;
                const childIds = items[catId] ?? [];
                return (
                  <SortableCategoryGroup
                    key={catId}
                    cat={cat}
                    childIds={childIds}
                    channelById={channelById}
                    isOwner={isOwner}
                    activeId={activeId}
                    makeChannelItemProps={makeChannelItemProps}
                    onAddChannel={() => setShowCreateChannel({ parentId: catId })}
                    onContextMenu={(e) => handleChannelRightClick(e, catId)}
                    faded={activeId === catId}
                  />
                );
              })}
            </SortableContext>

            <DragOverlay dropAnimation={null}>
              {activeChannel
                ? activeChannel.type === 'category'
                  ? <CategoryOverlay name={activeChannel.name} />
                  : <ChannelOverlay  channel={activeChannel} />
                : null}
            </DragOverlay>
          </DndContext>
        </div>

        {firebaseUser && <UserPanel userId={firebaseUser.uid} />}
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div
          className="fixed z-50 bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg shadow-2xl py-1 min-w-[160px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-3 py-2 text-sm text-[#e2e8f0] hover:bg-[#1e1e2e] transition-colors"
            onClick={() => {
              const ch = channels.find((c) => c.id === ctxMenu.channelId);
              if (ch) { setRenamingChannelId(ch.id); setRenameValue(ch.name); }
              setCtxMenu(null);
            }}
          >
            Edit Channel
          </button>
          <button
            className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-900/20 transition-colors"
            onClick={() => { handleDeleteChannel(ctxMenu.channelId); setCtxMenu(null); }}
          >
            Delete Channel
          </button>
        </div>
      )}

      {/* Modals */}
      {showInvite && firebaseUser && (
        <InviteModal guildId={guildId} inviterId={firebaseUser.uid} onClose={() => setShowInvite(false)} />
      )}
      {showSettings && guild && (
        <ServerSettingsModal guildId={guildId} currentName={guild.name} onClose={() => setShowSettings(false)} />
      )}
      {showCreateChannel !== null && (
        <CreateChannelModal
          defaultType={(showCreateChannel.defaultType as 'text' | 'voice' | 'category') ?? 'text'}
          categoryId={showCreateChannel.parentId}
          onClose={() => setShowCreateChannel(null)}
          onCreate={async (name, type, parentId) => { await createChannel(guildId, { name, type, parentId }); }}
        />
      )}
    </>
  );
}

// ─── Sortable wrappers ────────────────────────────────────────────────────────

interface ChannelItemBaseProps {
  channel: Channel;
  active: boolean;
  renaming: boolean;
  renameValue: string;
  renameRef: React.RefObject<HTMLInputElement>;
  onRenameChange: (v: string) => void;
  onRenameSubmit: () => void;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  gripListeners?: Record<string, unknown>;
  faded?: boolean;
}

function SortableChannelItem({ faded, ...props }: ChannelItemBaseProps & { faded?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: props.channel.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: faded ? 0.35 : 1 }}
      {...attributes}
    >
      <ChannelItem {...props} gripListeners={listeners} />
    </div>
  );
}

interface SortableCategoryGroupProps {
  cat: Channel;
  childIds: string[];
  channelById: Record<string, Channel>;
  isOwner: boolean;
  activeId: string | null;
  makeChannelItemProps: (ch: Channel) => Omit<ChannelItemBaseProps, 'gripListeners' | 'faded'>;
  onAddChannel: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  faded: boolean;
}

function SortableCategoryGroup({
  cat, childIds, channelById, isOwner, activeId,
  makeChannelItemProps, onAddChannel, onContextMenu, faded,
}: SortableCategoryGroupProps) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: cat.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: faded ? 0.35 : 1 }}
      {...attributes}
    >
      <CategoryHeader
        name={cat.name}
        catId={cat.id}
        showAdd={isOwner}
        onAdd={onAddChannel}
        onContextMenu={onContextMenu}
        gripListeners={isOwner ? listeners : undefined}
      />
      <SortableContext items={childIds} strategy={verticalListSortingStrategy}>
        {childIds.map((id) => {
          const ch = channelById[id];
          if (!ch) return null;
          const props = makeChannelItemProps(ch);
          return isOwner
            ? <SortableChannelItem key={id} {...props} faded={activeId === id} />
            : <ChannelItem         key={id} {...props} />;
        })}
      </SortableContext>
    </div>
  );
}

// ─── DragOverlay previews ─────────────────────────────────────────────────────

function ChannelOverlay({ channel }: { channel: Channel }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#1e1e2e] border border-violet-600/40 shadow-xl text-sm text-white opacity-90 mx-2">
      <span className="opacity-60 flex-shrink-0">{channel.type === 'voice' ? '🔊' : '#'}</span>
      <span className="truncate">{channel.name}</span>
    </div>
  );
}

function CategoryOverlay({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-1 px-2 py-1.5 rounded bg-[#1a1a28] border border-violet-600/40 shadow-xl text-[10px] font-semibold text-[#94a3b8] uppercase tracking-wider opacity-90">
      <GripIcon className="w-3 h-3 mr-1 opacity-60" />
      {name}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ onAdd, showAdd }: { onAdd: () => void; showAdd: boolean }) {
  return showAdd ? (
    <div className="flex items-center px-4 pt-4 pb-1 group">
      <span className="flex-1 text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider">Channels</span>
      <button onClick={onAdd} title="Create Channel" className="opacity-0 group-hover:opacity-100 text-[#6b7280] hover:text-white transition-all">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>
      </button>
    </div>
  ) : null;
}

interface CategoryHeaderProps {
  name: string;
  catId: string;
  showAdd: boolean;
  onAdd: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  gripListeners?: Record<string, unknown>;
}

function CategoryHeader({ name, catId: _catId, showAdd, onAdd, onContextMenu, gripListeners }: CategoryHeaderProps) {
  return (
    <div
      className="flex items-center gap-1 px-2 py-2 group cursor-default"
      onContextMenu={onContextMenu}
    >
      {gripListeners ? (
        <span
          {...gripListeners}
          onClick={(e) => e.stopPropagation()}
          className="cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 flex-shrink-0 text-[#4b5563] hover:text-[#6b7280] p-0.5 -ml-0.5"
          title="Drag to reorder"
        >
          <GripIcon className="w-2.5 h-2.5" />
        </span>
      ) : (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="#6b7280" className="rotate-90 flex-shrink-0">
          <path d="M2 3l3 4 3-4H2z" />
        </svg>
      )}
      <span className="flex-1 text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider truncate">
        {name}
      </span>
      {showAdd && (
        <button onClick={onAdd} title="Create Channel" className="opacity-0 group-hover:opacity-100 text-[#6b7280] hover:text-white transition-all">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>
        </button>
      )}
    </div>
  );
}

function ChannelItem({
  channel, active, renaming, renameValue, renameRef,
  onRenameChange, onRenameSubmit, onClick, onContextMenu, gripListeners,
}: ChannelItemBaseProps) {
  const isVoice = channel.type === 'voice';

  if (renaming) {
    return (
      <div className="mx-2 px-2 py-1">
        <input
          ref={renameRef}
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onBlur={onRenameSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRenameSubmit();
            if (e.key === 'Escape') onRenameChange('');
          }}
          className="w-full px-2 py-1 rounded bg-[#0a0a0f] border border-violet-600 text-white text-sm outline-none"
        />
      </div>
    );
  }

  return (
    <div className="group/row flex items-center mx-1 gap-0.5">
      {gripListeners && (
        <span
          {...gripListeners}
          onClick={(e) => e.stopPropagation()}
          className="cursor-grab active:cursor-grabbing opacity-0 group-hover/row:opacity-100 flex-shrink-0 p-1 text-[#4b5563] hover:text-[#6b7280]"
          title="Drag to reorder"
        >
          <GripIcon className="w-2 h-3" />
        </span>
      )}
      <button
        onClick={onClick}
        onContextMenu={onContextMenu}
        className={`
          flex-1 min-w-0 flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm transition-colors
          ${active ? 'bg-[#1e1e2e] text-white' : 'text-[#6b7280] hover:bg-[#1e1e2e]/60 hover:text-[#b0b8cc]'}
        `}
      >
        {isVoice ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="flex-shrink-0 opacity-70">
            <path d="M12 3a9 9 0 0 1 9 9h-2a7 7 0 0 0-7-7V3zm0 4a5 5 0 0 1 5 5h-2a3 3 0 0 0-3-3V7zm-1 5.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5-.67 1.5-1.5 1.5-1.5-.67-1.5-1.5zM3 11h2a7 7 0 0 0 7 7v2a9 9 0 0 1-9-9z" />
          </svg>
        ) : (
          <span className="text-base opacity-70 flex-shrink-0 leading-none">#</span>
        )}
        <span className="truncate flex-1 text-left">{channel.name}</span>
      </button>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function GripIcon({ className = 'w-2.5 h-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 8 14" fill="currentColor" className={className}>
      <circle cx="2" cy="2"  r="1.3" />
      <circle cx="6" cy="2"  r="1.3" />
      <circle cx="2" cy="7"  r="1.3" />
      <circle cx="6" cy="7"  r="1.3" />
      <circle cx="2" cy="12" r="1.3" />
      <circle cx="6" cy="12" r="1.3" />
    </svg>
  );
}

function MenuItem({ label, icon, onClick, danger, accent }: {
  label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean; accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors rounded-md mx-1 ${
        danger ? 'text-red-400 hover:bg-red-900/20 hover:text-red-300'
        : accent ? 'text-violet-400 hover:bg-violet-900/20 hover:text-violet-300'
        : 'text-[#e2e8f0] hover:bg-[#1e1e2e]'
      }`}
      style={{ width: 'calc(100% - 8px)' }}
    >
      <span className="w-4 h-4 flex-shrink-0">{icon}</span>
      {label}
    </button>
  );
}

function InviteIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" /></svg>;
}
function PlusCircleIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" /></svg>;
}
function FolderIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" /></svg>;
}
function GearIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" /></svg>;
}
function TrashIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg>;
}
function LeaveIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" /></svg>;
}
