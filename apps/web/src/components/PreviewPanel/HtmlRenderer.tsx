import DOMPurify from 'dompurify';

interface HtmlRendererProps {
  content: string;
}

export function HtmlRenderer({ content }: HtmlRendererProps) {
  // Sanitize content with DOMPurify — preserve inline style attributes for proper rendering
  const clean = DOMPurify.sanitize(content, { ADD_TAGS: ['style'], ADD_ATTR: ['xmlns', 'style'] });

  // Build HTML document — no hardcoded background so artifacts render their own
  const doc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; color: #e8f0ec; min-height: 100vh; }
    * { box-sizing: border-box; }
  </style>
</head>
<body>${clean}</body>
</html>`;

  return (
    <iframe
      srcDoc={doc}
      sandbox="allow-scripts allow-same-origin"
      title="Artifact preview"
      className="w-full h-full border-none"
    />
  );
}
