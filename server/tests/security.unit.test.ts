import { hashPassword, verifyPassword, newResetToken, hashResetToken } from "../src/security";

describe("Jednostkowe: bezpieczeństwo", () => {
  test("hash nie jest jawnym hasłem", async () => {
    const hashed = await hashPassword("Haslo1234!");
    expect(hashed).not.toBe("Haslo1234!");
  });

  test("poprawne hasło przechodzi, błędne jest odrzucane", async () => {
    const hashed = await hashPassword("Haslo1234!");
    expect(await verifyPassword("Haslo1234!", hashed)).toBe(true);
    expect(await verifyPassword("BledneHaslo1!", hashed)).toBe(false);
  });

  test("dwa tokeny resetu są różne", () => {
    expect(newResetToken()).not.toBe(newResetToken());
  });

  test("hash tokenu jest powtarzalny i ma 64 znaki", () => {
    const hash = hashResetToken("abc");
    expect(hash).toBe(hashResetToken("abc"));
    expect(hash).toHaveLength(64);
    expect(hash).not.toBe(hashResetToken("xyz"));
  });
});
