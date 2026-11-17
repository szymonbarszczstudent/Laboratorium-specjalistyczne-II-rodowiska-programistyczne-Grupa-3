import { UniqueConstraintError } from "sequelize";
import { sequelize } from "../src/db";
import { User } from "../src/User";
import { hashPassword, hashResetToken } from "../src/security";

beforeAll(async () => {
  await sequelize.sync({ force: true }); // UWAGA: wyłącznie testowa baza :memory:
});

afterEach(async () => {
  await User.destroy({ where: {} });
});

afterAll(async () => {
  await sequelize.close();
});

test("Integracja: zapis i odczyt użytkownika w SQLite", async () => {
  await User.create({
    email: "student@example.com",
    passwordHash: await hashPassword("Haslo1234!"),
    resetTokenHash: null,
    resetTokenExpiresAt: null
  });

  const stored = await User.findOne({ where: { email: "student@example.com" } });
  expect(stored?.email).toBe("student@example.com");
  expect(stored?.passwordHash).not.toBe("Haslo1234!");
});

test("Integracja: UNIQUE blokuje drugi taki sam email", async () => {
  const data = {
    email: "student@example.com",
    passwordHash: await hashPassword("Haslo1234!"),
    resetTokenHash: null,
    resetTokenExpiresAt: null
  };
  await User.create(data);
  await expect(User.create(data)).rejects.toBeInstanceOf(UniqueConstraintError);
});

test("Integracja: można zapisać token resetu i datę ważności", async () => {
  const user = await User.create({
    email: "student@example.com",
    passwordHash: await hashPassword("Haslo1234!"),
    resetTokenHash: null,
    resetTokenExpiresAt: null
  });
  const expires = new Date(Date.now() + 15 * 60 * 1000);
  const tokenHash = hashResetToken("token-testowy");
  await user.update({ resetTokenHash: tokenHash, resetTokenExpiresAt: expires });
  const stored = await User.findByPk(user.id);
  expect(stored?.resetTokenHash).toBe(tokenHash);
  expect(stored?.resetTokenExpiresAt).not.toBeNull();
});
