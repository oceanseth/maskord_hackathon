export default function LoadingScreen() {
  return (
    <div className="h-screen w-screen flex items-center justify-center bg-[#0a0a0f]">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-violet-600/20 border border-violet-700/30 flex items-center justify-center animate-pulse">
          <MaskIcon />
        </div>
        <span className="text-sm text-[#6b7280] font-mono">loading maskord...</span>
      </div>
    </div>
  );
}

function MaskIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
      <path
        d="M3 14C3 8.477 8.373 4 16 4s13 4.477 13 10c0 3.5-2.1 6.6-5.3 8.4l-1.2 4.6c-.2.8-1 1.3-1.8 1H11.3c-.8.3-1.6-.2-1.8-1L8.3 22.4C5.1 20.6 3 17.5 3 14z"
        fill="rgba(124,58,237,0.8)"
      />
      <circle cx="11" cy="13" r="2" fill="white" opacity="0.9" />
      <circle cx="21" cy="13" r="2" fill="white" opacity="0.9" />
    </svg>
  );
}
