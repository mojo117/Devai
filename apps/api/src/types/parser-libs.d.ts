// Type stubs for parser libraries installed on the runtime server (Clawd).

declare module 'pdf-parse' {
  interface PdfParseResult {
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    version: string;
    text: string;
  }
  function pdfParse(dataBuffer: Buffer): Promise<PdfParseResult>;
  export default pdfParse;
}

declare module 'mammoth' {
  interface ExtractResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }
  export function extractRawText(options: { buffer: Buffer }): Promise<ExtractResult>;
}

declare module 'xlsx' {
  interface WorkSheet {
    [key: string]: unknown;
  }
  interface WorkBook {
    SheetNames: string[];
    Sheets: Record<string, WorkSheet>;
  }
  interface ParsingOptions {
    type?: 'buffer' | 'binary' | 'string' | 'base64' | 'array';
  }
  export function read(data: Buffer, opts?: ParsingOptions): WorkBook;
  export const utils: {
    sheet_to_csv(sheet: WorkSheet): string;
  };
}
