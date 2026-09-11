import heroUrl from '../../assets/maskord-hero.webp';

// __WEB_BUILD_DATE__ is injected at build time by vite.web.config.ts.
// Falls back gracefully in the Electron dev build where the define isn't set.
declare const __WEB_BUILD_DATE__: string | undefined;

function getBuildLabel(): string | null {
  try {
    const raw = typeof __WEB_BUILD_DATE__ !== 'undefined' ? __WEB_BUILD_DATE__ : null;
    if (!raw) return null;
    const d = new Date(raw);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    });
  } catch {
    return null;
  }
}

export default function WelcomePanel() {
  const buildLabel = getBuildLabel();

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-[#0e0e16]">
      <div className="text-center flex flex-col items-center">
        {/* The masky.ai avatar wearing the Maskord name. Sized in rem rather
            than left at its native 640px so it reads as a mark, not a poster. */}
        <img
          src={heroUrl}
          alt="A neon carnival mask lit with the word Maskord"
          width={640}
          height={640}
          className="w-40 h-40 rounded-2xl object-cover mb-5 shadow-[0_0_40px_rgba(139,92,246,0.25)]"
        />
        <h2 className="font-display font-bold text-2xl text-white mb-2">
          Welcome to Maskord
        </h2>
        <p className="text-[#6b7280] text-sm max-w-xs">
          Select a server from the left sidebar, or create a new one to get started.
        </p>
      </div>

      {buildLabel && (
        <p className="absolute bottom-4 text-[11px] text-[#2a2a3e] select-none">
          web build · {buildLabel}
        </p>
      )}
    </div>
  );
}
