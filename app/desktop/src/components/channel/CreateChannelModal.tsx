import { useState } from 'react';
import Modal from '../ui/Modal';

type ChannelKind = 'text' | 'voice' | 'category';

interface Props {
  defaultType?: ChannelKind;
  categoryId?: string | null;
  onClose: () => void;
  onCreate: (name: string, type: ChannelKind, parentId: string | null) => Promise<void>;
}

export default function CreateChannelModal({ defaultType = 'text', categoryId = null, onClose, onCreate }: Props) {
  const [name, setName] = useState('');
  const [type, setType] = useState<ChannelKind>(defaultType);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await onCreate(name.trim().toLowerCase().replace(/\s+/g, '-'), type, categoryId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create channel');
      setLoading(false);
    }
  }

  const kinds: { value: ChannelKind; label: string; icon: React.ReactNode; desc: string }[] = [
    {
      value: 'text',
      label: 'Text Channel',
      icon: <span className="text-base leading-none">#</span>,
      desc: 'Post messages, files, and more',
    },
    {
      value: 'voice',
      label: 'Voice Channel',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 3a9 9 0 0 1 9 9h-2a7 7 0 0 0-7-7V3zm0 4a5 5 0 0 1 5 5h-2a3 3 0 0 0-3-3V7zm-1 5.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5-.67 1.5-1.5 1.5-1.5-.67-1.5-1.5zM3 11h2a7 7 0 0 0 7 7v2a9 9 0 0 1-9-9z" />
        </svg>
      ),
      desc: 'Hang out with voice and video',
    },
    {
      value: 'category',
      label: 'Category',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M4 6h16v2H4zm4 5h12v2H8zm-4 5h16v2H4z" />
        </svg>
      ),
      desc: 'Organize your channels',
    },
  ];

  return (
    <Modal title="Create Channel" onClose={onClose}>
      <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-4">
        {/* Type selector */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wide">Channel Type</p>
          {kinds.map((k) => (
            <label
              key={k.value}
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                type === k.value
                  ? 'border-violet-600 bg-violet-600/10'
                  : 'border-[#1e1e2e] hover:border-[#2e2e40] bg-[#0a0a0f]'
              }`}
            >
              <input
                type="radio"
                name="type"
                value={k.value}
                checked={type === k.value}
                onChange={() => setType(k.value)}
                className="sr-only"
              />
              <div className="w-8 h-8 rounded-full bg-[#1e1e2e] flex items-center justify-center text-[#94a3b8] flex-shrink-0">
                {k.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white">{k.label}</p>
                <p className="text-xs text-[#6b7280]">{k.desc}</p>
              </div>
              {type === k.value && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#7c3aed">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                </svg>
              )}
            </label>
          ))}
        </div>

        {/* Name input */}
        <div>
          <label className="block text-xs font-semibold text-[#94a3b8] uppercase tracking-wide mb-1.5">
            {type === 'category' ? 'Category Name' : 'Channel Name'}
          </label>
          <div className="relative">
            {type !== 'category' && (
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b7280] text-sm select-none">
                {type === 'voice' ? '🔊' : '#'}
              </span>
            )}
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder={type === 'category' ? 'New Category' : 'new-channel'}
              className={`w-full py-2.5 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] focus:border-violet-600 text-white text-sm outline-none transition-colors placeholder:text-[#6b7280] ${type !== 'category' ? 'pl-8 pr-3' : 'px-3'}`}
            />
          </div>
        </div>

        {error && (
          <p className="text-red-400 text-xs bg-red-900/20 border border-red-800/30 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="flex gap-3 justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-[#94a3b8] hover:text-white hover:bg-[#1e1e2e] transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
          >
            {loading ? 'Creating...' : 'Create Channel'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
