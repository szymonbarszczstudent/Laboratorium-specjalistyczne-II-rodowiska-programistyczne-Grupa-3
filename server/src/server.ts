import { config } from "./config";
import { app } from "./app";
import { sequelize } from "./db";
import "./User";

async function main() {
  if (config.jwtSecret.length < 32) {
    throw new Error("Ustaw JWT_SECRET (co najmniej 32 znaki) w pliku .env");
  }

  await sequelize.authenticate();
  await sequelize.sync(); // Tworzy brakujące tabele; zmiany schematu wymagają migracji.
  app.listen(config.port, "127.0.0.1", () => {
    console.log(`REST API: http://127.0.0.1:${config.port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
