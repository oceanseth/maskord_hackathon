export default function CTA() {
  return (
    <section className="py-32 px-6">
      <div className="max-w-3xl mx-auto text-center">
        <div className="relative rounded-3xl p-12 bg-maskord-surface border border-maskord-border overflow-hidden">
          {/* Glow */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-violet-700/20 rounded-full blur-3xl" />
          </div>

          <div className="relative z-10">
            <h2 className="font-display font-bold text-4xl md:text-5xl mb-4">
              Put on your first mask
            </h2>
            <p className="text-maskord-subtle text-lg mb-10 max-w-lg mx-auto">
              Free to use. No credit card required. Your communities are waiting.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <a
                href="https://maskord.com/download/mac"
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-maskord-accent hover:bg-violet-500 text-white font-semibold transition-all hover:scale-105 shadow-lg shadow-violet-900/30"
              >
                <AppleIcon /> Download for macOS
              </a>
              <a
                href="https://maskord.com/download/windows"
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl border border-maskord-border hover:border-violet-700/60 text-maskord-text font-semibold transition-all hover:bg-maskord-dark"
              >
                <WindowsIcon /> Download for Windows
              </a>
            </div>

            <div className="flex items-center justify-center gap-6 mt-8">
              <a href="https://apps.apple.com" className="text-maskord-muted hover:text-maskord-subtle text-sm transition-colors">
                iOS App Store
              </a>
              <span className="w-1 h-1 rounded-full bg-maskord-border" />
              <a href="https://play.google.com" className="text-maskord-muted hover:text-maskord-subtle text-sm transition-colors">
                Google Play
              </a>
              <span className="w-1 h-1 rounded-full bg-maskord-border" />
              <a href="https://maskord.com/app" className="text-maskord-muted hover:text-maskord-subtle text-sm transition-colors">
                Web App
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function AppleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}

function WindowsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 12V6.75l6-1.32v6.57H3zm17 0V4.5l-8 1.74V12h8zM3 13h6v6.57l-6-1.32V13zm17 0h-8v6.43l8 1.75V13z" />
    </svg>
  );
}
