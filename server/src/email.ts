import nodemailer from "nodemailer";
import { config } from "./config";

// Dane tylko do lokalnych testów. Nie przechowujemy tokenów w trybie SMTP.
const localResetTokens = new Map<string, string>();

export function getLocalResetToken(email: string): string | undefined {
  return localResetTokens.get(email);
}

export function clearLocalResetToken(token: string): void {
  for (const [email, savedToken] of localResetTokens) {
    if (savedToken === token) localResetTokens.delete(email);
  }
}

export async function sendResetEmail(to: string, token: string): Promise<void> {
  if (config.mailMode === "console") {
    localResetTokens.set(to, token);
    console.log(`\n[RESET HASŁA] Konto: ${to}\nTOKEN=${token}\nToken ważny 15 minut.\n`);
    return;
  }

  if (config.mailMode !== "smtp") throw new Error("Niepoprawny MAIL_MODE");
  if (!config.smtpHost || !config.mailFrom) {
    throw new Error("Uzupełnij SMTP_HOST i MAIL_FROM w .env");
  }

  const transport = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    ...(config.smtpUser && config.smtpPass
      ? { auth: { user: config.smtpUser, pass: config.smtpPass } }
      : {}),
  });

  await transport.sendMail({
    from: config.mailFrom,
    to,
    subject: "Reset hasła — Auth API",
    text: `Aby ustawić nowe hasło, wywołaj POST /api/auth/reset-password.\nTOKEN=${token}\nToken ważny 15 minut.`,
  });
}
