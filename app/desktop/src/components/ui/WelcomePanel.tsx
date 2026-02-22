export default function WelcomePanel() {
  return (
    <div className="flex-1 flex items-center justify-center bg-[#0e0e16]">
      <div className="text-center">
        <div className="text-6xl mb-4">🎭</div>
        <h2 className="font-display font-bold text-2xl text-white mb-2">
          Welcome to Maskord
        </h2>
        <p className="text-[#6b7280] text-sm max-w-xs">
          Select a server from the left sidebar, or create a new one to get started.
        </p>
      </div>
    </div>
  );
}
