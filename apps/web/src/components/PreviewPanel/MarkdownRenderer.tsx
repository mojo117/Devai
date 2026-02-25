import DOMPurify from 'dompurify';
import { marked } from 'marked';

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const html = marked.parse(content, { async: false }) as string;
  const clean = DOMPurify.sanitize(html, { ADD_TAGS: ['style'], ADD_ATTR: ['style'] });

  const doc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      margin: 0;
      padding: 1.5rem;
      font-family: system-ui, -apple-system, sans-serif;
      color: #e8f0ec;
      background: #0a1a12;
      min-height: 100vh;
      line-height: 1.7;
    }
    * { box-sizing: border-box; }
    h1, h2, h3, h4, h5, h6 { color: #7fffd4; margin-top: 1.5em; margin-bottom: 0.5em; }
    h1 { font-size: 1.75rem; border-bottom: 1px solid #1a3a2a; padding-bottom: 0.3em; }
    h2 { font-size: 1.4rem; border-bottom: 1px solid #1a3a2a; padding-bottom: 0.2em; }
    h3 { font-size: 1.15rem; }
    p { margin: 0.75em 0; }
    a { color: #7fffd4; text-decoration: underline; }
    code {
      background: #112a1a;
      border: 1px solid #1a3a2a;
      border-radius: 4px;
      padding: 0.15em 0.4em;
      font-size: 0.85em;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    }
    pre {
      background: #112a1a;
      border: 1px solid #1a3a2a;
      border-radius: 8px;
      padding: 1em;
      overflow-x: auto;
      margin: 1em 0;
    }
    pre code { background: none; border: none; padding: 0; font-size: 0.85em; }
    blockquote {
      border-left: 3px solid #7fffd4;
      margin: 1em 0;
      padding: 0.5em 1em;
      background: #112a1a;
      border-radius: 0 6px 6px 0;
    }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    th, td { border: 1px solid #1a3a2a; padding: 0.5em 0.75em; text-align: left; }
    th { background: #112a1a; color: #7fffd4; font-weight: 600; }
    tr:nth-child(even) { background: #0d2018; }
    ul, ol { padding-left: 1.5em; margin: 0.75em 0; }
    li { margin: 0.3em 0; }
    hr { border: none; border-top: 1px solid #1a3a2a; margin: 1.5em 0; }
    img { max-width: 100%; border-radius: 6px; }
  </style>
</head>
<body>${clean}</body>
</html>`;

  return (
    <iframe
      srcDoc={doc}
      sandbox="allow-scripts"
      title="Markdown preview"
      className="w-full h-full border-none"
    />
  );
}
