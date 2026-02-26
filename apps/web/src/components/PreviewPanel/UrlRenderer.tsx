interface UrlRendererProps {
  url: string;
  title?: string;
}

export function UrlRenderer({ url, title = 'Preview' }: UrlRendererProps) {
  return (
    <iframe
      src={url}
      sandbox="allow-scripts allow-forms"
      title={title}
      className="w-full h-full border-none"
      referrerPolicy="no-referrer"
    />
  );
}

