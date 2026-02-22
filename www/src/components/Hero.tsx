export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center px-6 pt-16 overflow-hidden">
      {/* Background glow orbs */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-violet-600/20 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-purple-800/15 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-900/10 rounded-full blur-3xl" />
      </div>

      {/* Grid overlay */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(rgba(124,58,237,1) 1px, transparent 1px), linear-gradient(90deg, rgba(124,58,237,1) 1px, transparent 1px)`,
          backgroundSize: '64px 64px',
        }}
      />

      <div className="relative z-10 max-w-4xl mx-auto text-center">
        {/* Floating mask */}
        <div className="flex justify-center mb-8">
          <div className="animate-mask-float">
            <MaskHero />
          </div>
        </div>

        <div className="animate-slide-up">
          <span className="inline-block px-3 py-1 rounded-full text-xs font-mono font-medium text-violet-300 bg-violet-900/30 border border-violet-800/50 mb-6 tracking-widest uppercase">
            Discord, reimagined
          </span>

          <h1 className="font-display font-bold text-5xl md:text-7xl leading-tight mb-6">
            Wear a different mask{' '}
            <span className="text-gradient">in every room</span>
          </h1>

          <p className="text-maskord-subtle text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
            Voice channels, text chat, and AI-powered identity — built for gaming communities
            and online friends who want to be playful with who they are.
            Your real identity stays protected. Your masks are limitless.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="https://maskord.com/download"
              className="w-full sm:w-auto px-8 py-4 rounded-xl bg-maskord-accent hover:bg-violet-500 text-white font-semibold text-base transition-all hover:scale-105 animate-glow-pulse shadow-lg shadow-violet-900/30"
            >
              Download for Desktop
            </a>
            <a
              href="https://maskord.com/app"
              className="w-full sm:w-auto px-8 py-4 rounded-xl border border-maskord-border hover:border-violet-700/60 text-maskord-text font-semibold text-base transition-all hover:bg-maskord-surface"
            >
              Open in Browser →
            </a>
          </div>
        </div>

        {/* Platform badges */}
        <div className="flex items-center justify-center gap-6 mt-12 text-xs text-maskord-muted">
          <span>macOS</span>
          <span className="w-1 h-1 rounded-full bg-maskord-border" />
          <span>Windows</span>
          <span className="w-1 h-1 rounded-full bg-maskord-border" />
          <span>Linux</span>
          <span className="w-1 h-1 rounded-full bg-maskord-border" />
          <span>iOS</span>
          <span className="w-1 h-1 rounded-full bg-maskord-border" />
          <span>Android</span>
        </div>
      </div>
    </section>
  );
}

function MaskHero() {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="maskGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#6d28d9" />
        </radialGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <ellipse cx="60" cy="68" rx="48" ry="36" fill="url(#maskGrad)" opacity="0.12" />
      <path
        d="M12 52C12 31.5 32.8 15 60 15s48 16.5 48 37c0 12.8-7.8 24.2-19.6 30.8l-4.4 16.7c-.7 2.8-3.6 4.7-6.6 3.5H42.6c-2.9 1.1-5.8-.7-6.6-3.5L31.6 82.8C19.8 76.2 12 64.8 12 52z"
        fill="url(#maskGrad)"
        filter="url(#glow)"
      />
      {/* Left eye */}
      <ellipse cx="42" cy="48" rx="8" ry="7" fill="white" opacity="0.95" />
      <ellipse cx="42" cy="48" rx="5" ry="4" fill="#1a0533" />
      <circle cx="44" cy="46" r="1.5" fill="white" />
      {/* Right eye */}
      <ellipse cx="78" cy="48" rx="8" ry="7" fill="white" opacity="0.95" />
      <ellipse cx="78" cy="48" rx="5" ry="4" fill="#1a0533" />
      <circle cx="80" cy="46" r="1.5" fill="white" />
      {/* Subtle smile */}
      <path d="M47 66c0 0 5.5 6 13 6s13-6 13-6" stroke="rgba(255,255,255,0.6)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      {/* Ornament lines */}
      <path d="M12 52l10-4M108 52l-10-4" stroke="rgba(168,85,247,0.4)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
