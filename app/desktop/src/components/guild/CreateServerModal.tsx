import { useState } from 'react';
import Modal from '../ui/Modal';

interface Props {
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}

export default function CreateServerModal({ onClose, onCreate }: Props) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await onCreate(name.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create server');
      setLoading(false);
    }
  }

  return (
    <Modal title="Create a Server" onClose={onClose}>
      <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-4">
        <p className="text-sm text-[#6b7280]">
          Give your server a name. You can always change it later.
        </p>
        <div>
          <label className="block text-xs font-semibold text-[#94a3b8] uppercase tracking-wide mb-1.5">
            Server Name
          </label>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            placeholder="My Awesome Server"
            className="w-full px-3 py-2.5 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] focus:border-violet-600 text-white text-sm outline-none transition-colors placeholder:text-[#6b7280]"
          />
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
            {loading ? 'Creating...' : 'Create Server'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
