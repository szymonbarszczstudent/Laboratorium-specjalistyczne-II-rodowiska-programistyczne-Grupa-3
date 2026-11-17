import { Router } from "express";
import { Op, UniqueConstraintError } from "sequelize";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { config } from "./config";
import { User } from "./User";
import { hashPassword, verifyPassword, newResetToken, hashResetToken } from "./security";
import { sendResetEmail, getLocalResetToken, clearLocalResetToken } from "./email";

export const authRouter = Router();

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(8).refine(
  (value) => Buffer.byteLength(value, "utf8") <= 72,
  "Hasło może mieć maksymalnie 72 bajty w UTF-8",
);
const credentials = z.object({ email, password });

// Rejestracja
// POST /api/auth/register { email, password }
authRouter.post("/register", async (req, res) => {
  const input = credentials.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Niepoprawne dane" }); return; }

  try {
    const user = await User.create({
      email: input.data.email,
      passwordHash: await hashPassword(input.data.password),
      resetTokenHash: null,
      resetTokenExpiresAt: null,
    });
    res.status(201).json({ id: user.id, email: user.email });
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      res.status(409).json({ error: "Email jest już zajęty" });
      return;
    }
    throw error;
  }
});

// Logowanie i wydanie JWT
// POST /api/auth/login { email, password }
authRouter.post("/login", async (req, res) => {
  const input = credentials.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Niepoprawne dane" }); return; }

  const user = await User.findOne({ where: { email: input.data.email } });
  if (!user || !(await verifyPassword(input.data.password, user.passwordHash))) {
    res.status(401).json({ error: "Nieprawidłowy email lub hasło" });
    return;
  }

  const token = jwt.sign(
    { sub: String(user.id) }, config.jwtSecret,
    { algorithm: "HS256", expiresIn: "1h" },
  );
  res.json({ token });
});

// Endpoint chroniony tokenem JWT
// GET /api/auth/me (Authorization: Bearer <JWT>)
authRouter.get("/me", async (req, res) => {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) { res.sendStatus(401); return; }

  try {
    const decoded = jwt.verify(header.slice(7), config.jwtSecret, {
      algorithms: ["HS256"],
    });
    if (typeof decoded === "string" || typeof decoded.sub !== "string") {
      res.sendStatus(401); return;
    }
    const userId = Number(decoded.sub);
    if (!Number.isSafeInteger(userId) || userId < 1) {
      res.sendStatus(401); return;
    }

    const user = await User.findByPk(userId);
    if (!user) { res.sendStatus(401); return; }
    res.json({ id: user.id, email: user.email });
  } catch {
    res.sendStatus(401);
  }
});

// Żądanie resetu: zawsze taka sama odpowiedź (bez ujawniania istnienia konta).
// POST /api/auth/forgot-password { email }
authRouter.post("/forgot-password", async (req, res) => {
  const input = z.object({ email }).safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Niepoprawny email" }); return; }

  const user = await User.findOne({ where: { email: input.data.email } });
  if (user) {
    const token = newResetToken();
    user.resetTokenHash = hashResetToken(token);
    user.resetTokenExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    try {
      await sendResetEmail(user.email, token);
    } catch (error) {
      // W prawdziwej usłudze: kolejka mailowa, ponowne próby, monitoring.
      // Nie ujawniamy w odpowiedzi, czy adres należy do użytkownika.
      console.error("Błąd dostarczenia instrukcji resetu:", error);
    }
  }
  res.status(202).json({ message: "Jeśli konto istnieje, przygotowano instrukcję resetu" });
});

// Jednorazowy reset hasła
// POST /api/auth/reset-password { token, newPassword }
authRouter.post("/reset-password", async (req, res) => {
  const input = z.object({
    token: z.string().regex(/^[a-f0-9]{64}$/),
    newPassword: password,
  }).safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Niepoprawne dane" }); return; }

  const tokenHash = hashResetToken(input.data.token);
  const count = await User.update({
    passwordHash: await hashPassword(input.data.newPassword),
    resetTokenHash: null,
    resetTokenExpiresAt: null,
  }, {
    where: {
      resetTokenHash: tokenHash,
      resetTokenExpiresAt: { [Op.gt]: new Date() },
    },
  });

  if (count[0] !== 1) {
    res.status(400).json({ error: "Token nieprawidłowy lub wygasł" });
    return;
  }
  clearLocalResetToken(input.data.token);
  res.json({ message: "Hasło zostało zmienione" });
});

// Wyłącznie do lokalnych testów automatycznych przy MAIL_MODE=console.
// Nigdy nie aktywować na publicznie dostępnym serwerze.
authRouter.get("/dev/reset-token", (req, res) => {
  if (
    process.env.NODE_ENV !== "development" ||
    config.mailMode !== "console" ||
    !config.enableTestTokenEndpoint
  ) {
    res.sendStatus(404);
    return;
  }

  const parsed = email.safeParse(req.query.email);
  if (!parsed.success) {
    res.status(400).json({ error: "Niepoprawny email" });
    return;
  }

  const token = getLocalResetToken(parsed.data);
  if (!token) {
    res.status(404).json({ error: "Brak tokenu dla tego adresu" });
    return;
  }

  res.json({ token });
});
