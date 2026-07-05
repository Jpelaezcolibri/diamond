import pino from "pino";
import { env } from "../config/env.js";

const baseOptions: pino.LoggerOptions = {
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "*.access_token",
      "*.accessToken",
      "*.token",
      "*.token_enc",
      "*.access_token_enc",
      "req.headers[\"x-api-key\"]",
      "req.headers.authorization"
    ],
    censor: "[REDACTED]"
  }
};

export const logger =
  env.NODE_ENV === "development"
    ? pino({
        ...baseOptions,
        transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } }
      })
    : pino(baseOptions);

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
