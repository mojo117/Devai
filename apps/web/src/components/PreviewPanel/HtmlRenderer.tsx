import DOMPurify from 'dompurify';

interface HtmlRendererProps {
  content: string;
}

export function HtmlRenderer({ content }: HtmlRendererProps) {
  // Sanitize content with DOMPurify
  const clean = DOMPurify.sanitize(content, { ADD_TAGS: ['style'], ADD_ATTR: ['xmlns'] });

  // Build HTML document with dark theme matching DevAI design
  const doc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4">
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #0a1a12; color: #e8f0ec; min-height: 100vh; }
    * { box-sizing: border-box; }
  </style>
</head>
<body>${clean}</body>
</html>`;

  return (
    <iframe
      srcDoc={doc}
      sandbox="allow-scripts"
      title="Artifact preview"
      className="w-full h-full border-none"
    />
  );
}
