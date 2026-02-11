interface PinnedFilesSectionProps {
  pinnedFiles: string[];
  onUnpinFile: (file: string) => void;
}

export function PinnedFilesSection({ pinnedFiles, onUnpinFile }: PinnedFilesSectionProps) {
  return (
    <div className="mt-3">
      <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
        Pinned Files
      </div>
      {pinnedFiles.length === 0 ? (
        <p className="text-xs text-gray-500">No pinned files.</p>
      ) : (
        <div className="space-y-1">
          {pinnedFiles.map((file) => (
            <div
              key={file}
              className="flex items-center justify-between bg-gray-900 rounded px-2 py-1 text-[11px] text-gray-200"
            >
              <span className="truncate">{file}</span>
              <button
                onClick={() => onUnpinFile(file)}
                className="text-[10px] text-gray-400 hover:text-gray-200"
              >
                Unpin
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
