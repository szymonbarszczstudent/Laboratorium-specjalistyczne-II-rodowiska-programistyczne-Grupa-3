import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

if (process.env.NODE_ENV !== "test" && existsSync(".env")) {
  loadEnvFile();
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  dbFile: process.env.DB_FILE ?? "./data/auth.sqlite",
  jwtSecret: process.env.JWT_SECRET ?? "",
  mailMode: (process.env.MAIL_MODE ?? "console") as "console" | "smtp",
  enableTestTokenEndpoint: process.env.ENABLE_TEST_TOKEN_ENDPOINT === "true",
  smtpHost: process.env.SMTP_HOST ?? "",
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpSecure: process.env.SMTP_SECURE === "true",
  smtpUser: process.env.SMTP_USER ?? "",
  smtpPass: process.env.SMTP_PASS ?? "",
  mailFrom: process.env.MAIL_FROM ?? "",
};
