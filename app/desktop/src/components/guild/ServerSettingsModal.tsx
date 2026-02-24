import { useState } from 'react';
import { updateGuildSettings } from '@maskord/shared';
import Modal from '../ui/Modal';

interface Props {
  guildId: string;
  currentName: string;
  onClose: () => void;
}

export default function ServerSettingsModal({ guildId, currentName, onClose }: Props) {
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || name.trim() === currentName) return;
    setSaving(true);
    setError(null);
    try {
      await updateGuildSettings(guildId, { name: name.trim() });
      setSaved(true);
      setTimeout(() => { setSaved(false); onClose(); }, 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      setSaving(false);
    }
  }

  return (
    <Modal title="Server Settings" onClose={onClose}>
      <form onSubmit={handleSave} className="px-6 pb-6 space-y-4">
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
            className="w-full px-3 py-2.5 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] focus:border-violet-600 text-white text-sm outline-none transition-colors"
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
            disabled={saving || !name.trim() || name.trim() === currentName}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              saved
                ? 'bg-green-600 text-white'
                : 'bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white'
            }`}
          >
            {saved ? 'Saved!' : saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
