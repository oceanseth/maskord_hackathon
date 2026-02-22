export default function Nav() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 glass border-b border-maskord-border">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MaskIcon className="w-8 h-8 text-maskord-accent" />
          <span className="font-display font-bold text-xl text-maskord-text tracking-tight">
            Maskord
          </span>
        </div>

        <div className="hidden md:flex items-center gap-8 text-sm text-maskord-subtle">
          <a href="#features" className="hover:text-maskord-text transition-colors">Features</a>
          <a href="#how-it-works" className="hover:text-maskord-text transition-colors">How it works</a>
          <a href="https://maskord.com/app" className="hover:text-maskord-text transition-colors">Open App</a>
        </div>

        <a
          href="https://maskord.com/app"
          className="px-4 py-2 rounded-lg bg-maskord-accent hover:bg-violet-500 text-white text-sm font-medium transition-colors"
        >
          Get Started
        </a>
      </div>
    </nav>
  );
}

function MaskIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="16" cy="18" rx="13" ry="10" fill="currentColor" opacity="0.15" />
      <path
        d="M3 14C3 8.477 8.373 4 16 4s13 4.477 13 10c0 3.5-2.1 6.6-5.3 8.4l-1.2 4.6c-.2.8-1 1.3-1.8 1H11.3c-.8.3-1.6-.2-1.8-1L8.3 22.4C5.1 20.6 3 17.5 3 14z"
        fill="currentColor"
      />
      <circle cx="11" cy="13" r="2" fill="white" opacity="0.9" />
      <circle cx="21" cy="13" r="2" fill="white" opacity="0.9" />
      <path d="M12 19c0 0 1.5 2 4 2s4-2 4-2" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}
