export const ALLOWED_EXTENSIONS = [
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.md', '.csv', '.msg', '.eml', '.oft', '.zip',
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
];

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export function validateFile(file: File): string | null {
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return `Dateityp nicht erlaubt: ${ext}`;
  }
  if (file.size > MAX_FILE_SIZE) {
    return 'Datei zu groß (max 10MB)';
  }
  return null;
}
