import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@maskord/shared';
import { useMaskyAvatars, type MaskyAvatarGroup } from '../../hooks/useMaskyAvatars';
import { useMaskordPro } from '../../hooks/useMaskordPro';
import ProPanel from '../pro/ProPanel';
import PaywallModal from '../pro/PaywallModal';
import ErrorBoundary from './ErrorBoundary';

interface Props {
  onClose: () => void;
}

type Section = 'avatar' | 'pro';

export default function SettingsModal({ onClose }: Props) {
  const { firebaseUser } = useAuth();
  const { avatarGroups, loading, selectedId, setSelected } = useMaskyAvatars(
    firebaseUser?.uid ?? null,
  );
  const pro = useMaskordPro(firebaseUser?.uid ?? null);
  const [section, setSection] = useState<Section>('avatar');
  const [paywall, setPaywall] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        className="w-[800px] max-w-[95vw] h-[540px] max-h-[90vh] bg-[#0e0e16] rounded-xl flex overflow-hidden shadow-2xl border border-[#1e1e2e]"
      >
        {/* ── Left sidebar ── */}
        <div className="w-52 flex-shrink-0 bg-[#0a0a12] border-r border-[#1e1e2e] flex flex-col py-4">
          <div className="px-4 mb-2">
            <span className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider">
              User Settings
            </span>
          </div>

          <NavItem
            label="Avatar"
            icon={<AvatarIcon />}
            active={section === 'avatar'}
            onClick={() => setSection('avatar')}
          />
          <NavItem
            label="Maskord Pro"
            icon={<SparkIcon />}
            active={section === 'pro'}
            onClick={() => setSection('pro')}
            // The status a subscriber is looking for, without opening the tab.
            badge={pro.loading ? undefined : pro.pro ? 'Active' : pro.lapsed ? 'Expired' : undefined}
          />

          {/* Placeholder items — add sections here as features ship */}
          <NavItem label="AI Voice" icon={<MicIcon />} disabled />
          <NavItem label="Appearance" icon={<PaletteIcon />} disabled />

          <div className="flex-1" />

          <div className="px-3 pb-1">
            <button
              onClick={onClose}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-[#4b5563] hover:text-[#6b7280] transition-colors"
            >
              <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </svg>
              <span>Close  (Esc)</span>
            </button>
          </div>
        </div>

        {/* ── Main content ── */}
        <div className="flex-1 overflow-y-auto scrollable p-8">
          {section === 'pro' ? (
            <>
              <h2 className="text-xl font-bold text-white mb-1">Maskord Pro</h2>
              <p className="text-sm text-[#6b7280] mb-6">
                One subscription seats any mask another member has published — and publishing your
                own is how you earn from them.
              </p>

              {firebaseUser ? (
                <ErrorBoundary
                  fallback={
                    <div className="text-sm text-[#6b7280] border border-[#1e1e2e] rounded-lg px-4 py-5">
                      Subscriptions are unavailable right now — this build is talking to a Convex
                      deployment that does not have the Pro functions published yet.
                    </div>
                  }
                >
                  <ProPanel
                    uid={firebaseUser.uid}
                    displayName={firebaseUser.displayName ?? 'Someone'}
                    pro={pro}
                    onUpgrade={() => setPaywall(true)}
                  />
                </ErrorBoundary>
              ) : (
                <div className="text-sm text-[#6b7280] border border-[#1e1e2e] rounded-lg px-4 py-5">
                  Sign in to subscribe — a purchase has to belong to an account, or it disappears
                  with the browser.
                </div>
              )}
            </>
          ) : (
            <>
          <h2 className="text-xl font-bold text-white mb-1">Avatar</h2>
          <p className="text-sm text-[#6b7280] mb-6">
            Powered by{' '}
            <a
              href="https://masky.ai"
              target="_blank"
              rel="noreferrer"
              className="text-violet-400 hover:text-violet-300 transition-colors"
            >
              masky.ai
            </a>
            . Your avatar's personality will reinterpret your voice in channels.
          </p>

          {/* ── Selected Avatar ── */}
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <label className="block text-xs font-semibold text-[#9ca3af] uppercase tracking-wider">
                Selected Avatar
              </label>
              {/* Subtle refresh indicator — only shown while Firestore is loading
                  AND we already have cached data to display */}
              {loading && avatarGroups.length > 0 && (
                <span className="text-[10px] text-[#4b5563]">Updating…</span>
              )}

              <a
                href="https://masky.ai"
                target="_blank"
                rel="noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                </svg>
                Create new
              </a>
            </div>

            {/* Spinner only if we have nothing cached yet */}
            {loading && avatarGroups.length === 0 ? (
              <div className="text-sm text-[#6b7280] py-4">Loading avatars…</div>
            ) : (
              <div className="space-y-2">
                {/* None option */}
                <AvatarOption
                  thumbnailUrl=""
                  label="None"
                  sublabel="Use your real voice without any avatar"
                  selected={!selectedId}
                  onClick={() => setSelected(null)}
                />

                {avatarGroups.length === 0 ? (
                  <div className="rounded-lg border border-[#1e1e2e] px-4 py-5 text-sm text-[#6b7280]">
                    No avatars found on your masky.ai account.{' '}
                    <a
                      href="https://masky.ai"
                      target="_blank"
                      rel="noreferrer"
                      className="text-violet-400 hover:text-violet-300 transition-colors"
                    >
                      Create one →
                    </a>
                  </div>
                ) : (
                  avatarGroups.map((g) => (
                    <AvatarOption
                      key={g.id}
                      thumbnailUrl={g.thumbnailUrl}
                      label={g.displayName}
                      sublabel={
                        g.personalityPrompt
                          ? g.personalityPrompt.slice(0, 80) + (g.personalityPrompt.length > 80 ? '…' : '')
                          : 'No personality prompt set'
                      }
                      hasVoice={!!g.humeVoiceId}
                      selected={selectedId === g.id}
                      onClick={() => setSelected(g.id)}
                    />
                  ))
                )}
              </div>
            )}

            {selectedId && !loading && (
              <p className="mt-4 text-xs text-[#4b5563]">
                Avatar active — your voice will be reinterpreted and spoken in{' '}
                <span className="text-violet-400">
                  {avatarGroups.find((g) => g.id === selectedId)?.displayName ?? 'this avatar'}
                </span>
                's voice when speaking in channels.
              </p>
            )}
          </div>

          {/* ── Coming soon ── */}
          <div className="rounded-lg border border-[#1e1e2e] px-4 py-4">
            <p className="text-xs font-semibold text-[#6b7280] uppercase tracking-wider mb-1">
              Coming soon
            </p>
            <p className="text-sm text-[#4b5563]">
              AI voice reinterpretation (on-device WebGPU or Gemini API fallback) and HeyGen
              streaming video will be added in a future update.
            </p>
          </div>
            </>
          )}
        </div>
      </div>

      {paywall && (
        <PaywallModal
          offering={pro.offering}
          lapsed={pro.lapsed}
          onPurchased={() => {
            void pro.refresh();
            setPaywall(false);
          }}
          onClose={() => setPaywall(false)}
        />
      )}
    </div>
  );
}

// ─── Avatar option row ─────────────────────────────────────────────────────────

interface AvatarOptionProps {
  thumbnailUrl?: string;
  label: string;
  sublabel?: string;
  hasVoice?: boolean;
  selected: boolean;
  onClick: () => void;
}

function AvatarOption({ thumbnailUrl, label, sublabel, hasVoice, selected, onClick }: AvatarOptionProps) {
  const initials = label.substring(0, 2).toUpperCase();

  return (
    <button
      onClick={onClick}
      className={`
        w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all
        ${selected
          ? 'border-violet-500/60 bg-violet-600/10'
          : 'border-[#1e1e2e] hover:border-[#2a2a3e] hover:bg-[#12121a]'
        }
      `}
    >
      {/* Thumbnail */}
      <div className="w-10 h-10 rounded-full bg-violet-600/20 overflow-hidden flex-shrink-0 flex items-center justify-center">
        {thumbnailUrl
          ? <img src={thumbnailUrl} alt={label} className="w-full h-full object-cover" />
          : <span className="text-sm font-bold text-violet-300">{initials}</span>
        }
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold truncate ${selected ? 'text-white' : 'text-[#b0b8cc]'}`}>
            {label}
          </span>
          {hasVoice && (
            <span className="flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-violet-600/20 text-violet-400">
              Voice
            </span>
          )}
        </div>
        {sublabel && (
          <p className="text-xs text-[#4b5563] truncate mt-0.5">{sublabel}</p>
        )}
      </div>

      {/* Selection indicator */}
      <div className={`
        w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center
        ${selected ? 'border-violet-500 bg-violet-500' : 'border-[#2a2a3e]'}
      `}>
        {selected && (
          <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="currentColor">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
          </svg>
        )}
      </div>
    </button>
  );
}

// ─── Sidebar nav item ─────────────────────────────────────────────────────────

function NavItem({
  label, icon, active, disabled, onClick, badge,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  badge?: string;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`
        w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors text-left
        ${active
          ? 'bg-violet-600/20 text-white font-medium'
          : disabled
          ? 'text-[#3a3a4e] cursor-default'
          : 'text-[#6b7280] hover:text-white hover:bg-[#1e1e2e]/50'
        }
      `}
    >
      <span className="w-4 h-4 flex-shrink-0">{icon}</span>
      {label}
      {badge && (
        <span className="ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded bg-violet-600/20 text-violet-300">
          {badge}
        </span>
      )}
      {disabled && (
        <span className="ml-auto text-[10px] text-[#3a3a4e] font-medium">Soon</span>
      )}
    </button>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function AvatarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <path d="M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2L12 2zm6.5 12l1.1 2.9 2.9 1.1-2.9 1.1L18.5 22l-1.1-2.9-2.9-1.1 2.9-1.1L18.5 14z" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V21c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z" />
    </svg>
  );
}

function PaletteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" />
    </svg>
  );
}
