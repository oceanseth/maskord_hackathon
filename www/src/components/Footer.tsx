export default function Footer() {
  return (
    <footer className="border-t border-maskord-border bg-maskord-darker">
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <span className="font-display font-bold text-lg text-maskord-text">Maskord</span>
            <span className="text-maskord-border">·</span>
            <span className="text-xs text-maskord-muted font-mono">A Discord alternative</span>
          </div>

          <div className="flex items-center gap-8 text-sm text-maskord-muted">
            <a href="https://maskord.com/privacy" className="hover:text-maskord-subtle transition-colors">Privacy</a>
            <a href="https://maskord.com/terms" className="hover:text-maskord-subtle transition-colors">Terms</a>
            <a href="https://masky.ai" className="hover:text-maskord-subtle transition-colors">masky.ai</a>
            <a href="https://github.com/maskord" className="hover:text-maskord-subtle transition-colors">GitHub</a>
          </div>
        </div>

        <div className="mt-8 pt-8 border-t border-maskord-border text-center text-xs text-maskord-muted font-mono">
          © {new Date().getFullYear()} Maskord. Not affiliated with Discord Inc.
          <br />
          <span className="opacity-60">Your masks. Your rules. Your community.</span>
        </div>
      </div>
    </footer>
  );
}
