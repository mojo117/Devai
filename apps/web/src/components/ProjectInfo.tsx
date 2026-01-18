interface ProjectInfoProps {
  projectRoot?: string | null;
}

export function ProjectInfo({ projectRoot }: ProjectInfoProps) {
  if (!projectRoot) {
    return (
      <div className="text-sm text-gray-500">
        No project configured
      </div>
    );
  }

  // Extract just the folder name for display
  const folderName = projectRoot.split(/[/\\]/).filter(Boolean).pop() || projectRoot;

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-gray-400">Project:</span>
      <span
        className="bg-gray-700 px-2 py-1 rounded text-gray-200 font-mono"
        title={projectRoot}
      >
        {folderName}
      </span>
    </div>
  );
}
