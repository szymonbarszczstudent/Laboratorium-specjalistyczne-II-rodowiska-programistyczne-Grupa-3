import express from "express";
import { authRouter } from "./auth.routes";
import { sequelize } from "./db";

export const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/health/db", async (_req, res) => {
  try {
    await sequelize.authenticate();
    res.json({ database: "connected" });
  } catch {
    res.status(503).json({ database: "unavailable" });
  }
});
app.use("/api/auth", authRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Błąd serwera:", err);
  res.status(500).json({ error: "Błąd wewnętrzny serwera" });
});
