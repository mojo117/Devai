import { useState, useEffect, useCallback } from 'react';
import { listUserfiles, uploadUserfile, deleteUserfile } from '../api';
import type { UserfileInfo } from '../api';

const ALLOWED_EXTENSIONS = [
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.md', '.csv', '.msg', '.eml', '.oft', '.zip',
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
];

const MAX_FILE_SIZE = 10 * 1024 * 1024;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(name: string): string {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) return '\u{1F5BC}';
  if (ext === '.pdf') return '\u{1F4C4}';
  if (['.doc', '.docx'].includes(ext)) return '\u{1F4DD}';
  if (['.xls', '.xlsx', '.csv'].includes(ext)) return '\u{1F4CA}';
  if (['.ppt', '.pptx'].includes(ext)) return '\u{1F4CA}';
  if (['.msg', '.eml', '.oft'].includes(ext)) return '\u{2709}';
  if (ext === '.zip') return '\u{1F4E6}';
  return '\u{1F4CE}';
}

export function UserfilesPanelContent() {
  const [files, setFiles] = useState<UserfileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFiles = useCallback(async () => {
    try {
      const result = await listUserfiles();
      setFiles(result.files);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load files');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const validateFile = (file: File): string | null => {
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return `File type not allowed: ${ext}`;
    }
    if (file.size > MAX_FILE_SIZE) {
      return 'File too large (max 10MB)';
    }
    return null;
  };

  const handleUpload = async (fileList: FileList | File[]) => {
    const filesToUpload = Array.from(fileList);
    if (filesToUpload.length === 0) return;

    setUploading(true);
    setError(null);

    for (const file of filesToUpload) {
      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        continue;
      }
      try {
        await uploadUserfile(file);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed');
      }
    }

    setUploading(false);
    await fetchFiles();
  };

  const handleDelete = async (filename: string) => {
    try {
      await deleteUserfile(filename);
      setFiles((prev) => prev.filter((f) => f.name !== filename));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleUpload(e.target.files);
    }
    e.target.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files);
    }
  };

  return (
    <div className="p-4 space-y-4">
      {/* Upload zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-5 text-center transition-all cursor-pointer ${
          isDragOver
            ? 'border-devai-accent bg-devai-accent/5'
            : 'border-devai-border hover:border-devai-text-muted'
        } ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
        onClick={() => document.getElementById('userfile-input')?.click()}
      >
        <input
          type="file"
          id="userfile-input"
          className="hidden"
          onChange={handleFileInput}
          disabled={uploading}
          multiple
        />
        <div className="text-2xl mb-1">{uploading ? '\u23F3' : '\u{1F4C1}'}</div>
        <p className="text-sm text-devai-text-secondary">
          {uploading ? 'Uploading...' : 'Drop files here or click to browse'}
        </p>
        <p className="text-xs text-devai-text-muted mt-1">
          Max 10MB &middot; PDF, Office, Images, Text, Email, ZIP
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="text-xs text-red-400 bg-red-400/10 rounded px-3 py-2">
          {error}
        </div>
      )}

      {/* File list */}
      {loading ? (
        <div className="text-center text-sm text-devai-text-muted py-6">Loading...</div>
      ) : files.length === 0 ? (
        <div className="text-center text-sm text-devai-text-muted py-6">No files uploaded yet</div>
      ) : (
        <div className="space-y-1">
          <div className="text-xs text-devai-text-muted mb-2">{files.length} file{files.length !== 1 ? 's' : ''}</div>
          {files.map((file) => (
            <div
              key={file.name}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-devai-card hover:bg-devai-card/80 group"
            >
              <span className="text-base flex-shrink-0">{getFileIcon(file.name)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-devai-text truncate" title={file.name}>{file.name}</p>
                <p className="text-xs text-devai-text-muted">
                  {formatFileSize(file.size)} &middot; {new Date(file.modifiedAt).toLocaleDateString('de-DE')}
                </p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(file.name);
                }}
                className="text-devai-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                title="Delete"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
