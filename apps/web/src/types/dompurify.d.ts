declare module 'dompurify' {
  export interface Config {
    ADD_TAGS?: string[];
    ADD_ATTR?: string[];
  }

  export function sanitize(dirty: string, config?: Config): string;

  const DOMPurify: {
    sanitize: typeof sanitize;
  };

  export default DOMPurify;
}

