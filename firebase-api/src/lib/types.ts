import type { FastifyRequest as Request } from "fastify";

export type Row = Record<string, any>;
export type FastifyRequest = Pick<Request, "headers" | "body" | "params" | "query">;
