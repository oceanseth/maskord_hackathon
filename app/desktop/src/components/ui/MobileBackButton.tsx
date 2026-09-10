interface Props {
  onClick: () => void;
}

export default function MobileBackButton({ onClick }: Props) {
  return (
    <button
      onClick={onClick}
      title="Back"
      className="md:hidden -ml-2 flex-shrink-0 w-9 h-9 rounded-md flex items-center justify-center text-[#9ca3af] hover:text-white hover:bg-[#1e1e2e] transition-colors"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
      </svg>
    </button>
  );
}
