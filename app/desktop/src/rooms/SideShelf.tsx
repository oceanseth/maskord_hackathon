import { useEffect, useState, type ReactNode } from 'react';

/** Below this, the stage row and an 18rem plate cannot share the window. */
const NARROW = '(max-width: 1023px)';

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(NARROW).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(NARROW);
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return narrow;
}

/**
 * The right-hand plate beside a stage or a table.
 *
 * On a wide window it docks in the row. On a phone, or once minimized, it
 * leaves the row as a shelf tab so the stage can use the width. The tab pulls
 * the plate out over the stage; minimize (or Escape, or a tap on the stage)
 * puts it back. The parent row has to be `relative` so the overlay is contained.
 */
export function SideShelf({
  label,
  children,
  bodyClassName = '',
  asideClassName = '',
  inlineWidthClass = 'w-72',
  overlayWidthClass = 'w-72 max-w-[88vw]',
  startOpen = false,
}: {
  label: string;
  children: ReactNode;
  /** Padding, gap, and anything else the scrolling body needs. */
  bodyClassName?: string;
  /** Extra classes on the plate itself (a theme scope, for instance). */
  asideClassName?: string;
  inlineWidthClass?: string;
  overlayWidthClass?: string;
  /** Narrow screens start with the plate open over the stage. */
  startOpen?: boolean;
}) {
  const narrow = useNarrow();
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    const isNarrow = window.matchMedia(NARROW).matches;
    return isNarrow ? startOpen : true;
  });

  // Crossing the breakpoint restores the layout that fits: docked when there
  // is room, the narrow default when there is not.
  useEffect(() => {
    setOpen(narrow ? startOpen : true);
  }, [narrow, startOpen]);

  useEffect(() => {
    if (!open || !narrow) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, narrow]);

  const body = (
    <div className={`scrollable flex min-h-0 flex-1 flex-col overflow-y-auto ${bodyClassName}`}>
      {children}
    </div>
  );

  const minimize = (
    <button
      type="button"
      onClick={() => setOpen(false)}
      title="Minimize"
      aria-label={`Minimize ${label}`}
      className="flex h-7 w-7 items-center justify-center rounded-md text-[#94a3b8] hover:bg-[#1e1e2e] hover:text-white"
    >
      <Chevron dir="right" />
    </button>
  );

  const header = (
    <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-[#1f1f2e] px-2">
      <span className="truncate pl-1 text-[11px] font-semibold uppercase tracking-wide text-[#8b8fa3]">
        {label}
      </span>
      {minimize}
    </div>
  );

  if (!narrow && open) {
    return (
      <aside
        className={`${inlineWidthClass} ${asideClassName} flex min-h-0 shrink-0 flex-col border-l border-[#1f1f2e] bg-[#0c0c14]`}
      >
        {header}
        {body}
      </aside>
    );
  }

  return (
    <>
      {narrow && open && (
        <>
          <div
            aria-hidden
            className="absolute inset-0 z-30 bg-black/50"
            onClick={() => setOpen(false)}
          />
          <aside
            className={`absolute inset-y-0 right-0 z-40 ${overlayWidthClass} ${asideClassName} flex min-h-0 flex-col border-l border-[#1f1f2e] bg-[#0c0c14] shadow-2xl`}
          >
            {header}
            {body}
          </aside>
        </>
      )}
      {!(narrow && open) && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={`Open ${label}`}
          aria-label={`Open ${label}`}
          aria-expanded={false}
          className="flex w-9 shrink-0 flex-col items-center justify-center gap-2 border-l border-[#1f1f2e] bg-[#12121c] text-[#c8d0e0] hover:bg-[#1e1e2e] hover:text-white"
        >
          <Chevron dir="left" />
          <span className="text-[10px] font-semibold tracking-wide [writing-mode:vertical-rl] rotate-180">
            {label}
          </span>
        </button>
      )}
    </>
  );
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
    </svg>
  );
}
