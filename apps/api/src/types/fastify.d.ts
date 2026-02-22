import 'fastify';

declare module 'fastify' {
  interface MultipartUpload {
    filename: string;
    mimetype: string;
    toBuffer(): Promise<Buffer>;
  }

  interface FastifyRequest {
    user?: {
      username: string;
    };
    cookies?: Record<string, string>;
    file(): Promise<MultipartUpload | undefined>;
  }

  interface FastifyReply {
    setCookie(
      name: string,
      value: string,
      options?: Record<string, unknown>
    ): FastifyReply;
    clearCookie(name: string, options?: Record<string, unknown>): FastifyReply;
  }
}
