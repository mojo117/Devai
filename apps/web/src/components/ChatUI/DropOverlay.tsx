interface DropOverlayProps {
  visible: boolean;
}

export function DropOverlay({ visible }: DropOverlayProps) {
  if (!visible) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-devai-bg/80 backdrop-blur-sm border-2 border-dashed border-devai-accent rounded-lg pointer-events-none">
      <div className="text-center">
        <svg
          className="mx-auto h-12 w-12 text-devai-accent mb-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
        <p className="text-lg font-medium text-devai-text">Datei hier ablegen</p>
        <p className="text-sm text-devai-text-secondary mt-1">
          PDF, Office, Bilder, Text, E-Mail, ZIP
        </p>
      </div>
    </div>
  );
}
