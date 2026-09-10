import { useRef, useState } from 'react';

interface Props {
  placeholder?: string;
  onSend:       (text: string) => Promise<void> | void;
  disabled?:    boolean;
  /** Wrapper padding around the input bar. TextChannel uses `px-4 pb-4`;
   *  embedded chat panels may want tighter spacing. */
  padding?:     string;
  autoFocus?:   boolean;
}

/**
 * Single-line auto-growing textarea with an enter-to-send button. Used by
 * both #text channels and the chat panel embedded in voice channels.
 */
export default function MessageInput({
  placeholder = 'Send a message...',
  onSend,
  disabled,
  padding   = 'px-4 pb-4',
  autoFocus,
}: Props) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  async function submit() {
    const t = text.trim();
    if (!t || disabled || sending) return;
    setSending(true);
    setText('');
    try { await onSend(t); } finally {
      setSending(false);
      ref.current?.focus();
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className={`${padding} flex-shrink-0`}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="flex items-end gap-3 bg-[#1a1a28] rounded-xl px-4 py-3 border border-[#2a2a40]">
          <textarea
            ref={ref}
            autoFocus={autoFocus}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKey}
            placeholder={placeholder}
            rows={1}
            disabled={disabled || sending}
            className="flex-1 bg-transparent text-white text-sm outline-none resize-none placeholder:text-[#6b7280] selectable"
            style={{ maxHeight: '200px' }}
          />
          <button
            type="submit"
            disabled={!text.trim() || disabled || sending}
            className="w-8 h-8 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-30 flex items-center justify-center transition-colors flex-shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
