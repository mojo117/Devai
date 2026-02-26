interface PdfRendererProps {
  url: string;
}

export function PdfRenderer({ url }: PdfRendererProps) {
  return (
    <object
      data={url}
      type="application/pdf"
      className="w-full h-full"
      aria-label="PDF preview"
    >
      <div className="h-full flex items-center justify-center p-6 text-sm text-devai-text-muted">
        PDF preview unavailable. <a className="underline" href={url} target="_blank" rel="noreferrer">Open file</a>
      </div>
    </object>
  );
}

