import { mkdirSync } from "node:fs";
import path from "node:path";
import { Sequelize } from "sequelize";
import { config } from "./config";

const storage = process.env.NODE_ENV === "test"
  ? ":memory:"
  : path.resolve(config.dbFile);

if (storage !== ":memory:") {
  mkdirSync(path.dirname(storage), { recursive: true });
}

export const sequelize = new Sequelize({
  dialect: "sqlite",
  storage,
  logging: false,
  pool: { max: 1, min: 0, idle: 10_000 },
});
