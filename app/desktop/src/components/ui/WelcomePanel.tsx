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
      <div className="text-center">
        <div className="text-6xl mb-4">🎭</div>
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
