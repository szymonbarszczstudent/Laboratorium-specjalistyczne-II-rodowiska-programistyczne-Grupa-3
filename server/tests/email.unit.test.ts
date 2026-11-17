import { sendResetEmail, getLocalResetToken, clearLocalResetToken } from "../src/email";

test("Tryb console udostępnia lokalny token resetujący", async () => {
  const token = "a".repeat(64);
  const email = "testowy@example.com";
  await sendResetEmail(email, token);
  expect(getLocalResetToken(email)).toBe(token);
  clearLocalResetToken(token);
  expect(getLocalResetToken(email)).toBeUndefined();
});
