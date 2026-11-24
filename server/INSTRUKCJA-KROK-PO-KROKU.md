# Serwer Auth API — implementacja i testowanie

Prosty backend REST API: rejestracja, logowanie, JWT, profil użytkownika, jednorazowy reset hasła, SQLite i automatyczne testy. Podstawowy wariant uruchamia się **bez dodatkowych usług**. Token resetu hasła można odczytać w terminalu, a Bruno CLI pobiera go przez specjalny endpoint dostępny wyłącznie lokalnie. Wysyłka na prawdziwy e-mail jest opcjonalna — zobacz sekcję oznaczoną gwiazdką.

## 1. Przygotowanie środowiska i utworzenie projektu

Potrzebujesz: **Node.js 24 lub 26 LTS**, terminala, edytora (np. VS Code) oraz opcjonalnie aplikacji Bruno do wygodnego wysyłania żądań. Zainstalowanie bazy danych jako osobnego programu nie jest wymagane — SQLite przechowuje dane w pliku.

Sprawdź wersje:

```powershell
node -v
npm -v
```

Utwórz projekt od zera:

```powershell
mkdir auth-api
cd auth-api
npm init -y
```

Zainstaluj biblioteki aplikacji:

```powershell
npm install express@5 sequelize@6 sqlite3 bcryptjs jsonwebtoken nodemailer zod@4
```

Nodemailer jest wykorzystywany dopiero wtedy, gdy włączysz *opcjonalną* wysyłkę SMTP.

Zainstaluj narzędzia i biblioteki testowe:

```powershell
npm install -D typescript tsx @types/node @types/express @types/jsonwebtoken @types/nodemailer jest@30 @types/jest@30 ts-jest@29.4 @usebruno/cli@3
```

`tsx watch` automatycznie restartuje serwer po zapisaniu plików `.ts`. `Jest` uruchamia testy jednostkowe i integracyjne. `Bruno CLI` wywołuje działający serwer HTTP i sprawdza cały scenariusz.

**Alternatywa bez przepisywania:** rozpakuj gotowy ZIP i uruchom `npm install` — wszystkie pliki znajdują się już we właściwych katalogach.


## 2. Konfiguracja TypeScript i poleceń npm

W pliku `package.json` zamień samą sekcję `scripts` na poniższą. Polecenie `test:api` zakłada, że kolekcja Bruno jest zapisana w katalogu `bruno/`.

```json
"scripts": {
  "dev": "tsx watch src/server.ts",
  "build": "tsc",
  "start": "node dist/server.js",
  "typecheck": "tsc --noEmit",
  "test": "jest --runInBand",
  "test:api": "cd bruno && bru run --env local --reporter-html ../bruno-report.html"
}
```

`target: ES2024` wybiera wersję wynikowego JavaScript, `module: CommonJS` upraszcza konfigurację, `strict: true` włącza dokładne typowanie.


**Plik `tsconfig.json`:**

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": [
    "src/**/*.ts"
  ]
}
```


## 3. Konfiguracja środowiska — bez zewnętrznych usług

Skopiuj `.env.example` do `.env`:

```powershell
Copy-Item .env.example .env
```

Wygeneruj sekret podpisujący JWT:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Wklej wynik do pola `JWT_SECRET` w `.env`. Nie umieszczaj pliku `.env` w repozytorium.

**Plik `.env.example` zawiera wariant podstawowy (`MAIL_MODE=console`) oraz ustawienia SMTP oznaczone gwiazdką.**


**Plik `.env.example`:**

```dotenv
PORT=3000
NODE_ENV=development
DB_FILE=./data/auth.sqlite
JWT_SECRET=WPISZ_WYGENEROWANY_LOSOWY_SEKRET

# Działa bez dodatkowych usług: token resetu trafia do konsoli
MAIL_MODE=console
ENABLE_TEST_TOKEN_ENDPOINT=true

# * OPCJONALNE: wysyłka prawdziwego e-maila przez SMTP
# Ustaw MAIL_MODE=smtp, wyłącz ENABLE_TEST_TOKEN_ENDPOINT
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
MAIL_FROM=
```


`MAIL_MODE=console` oznacza, że reset hasła nie wymaga konfigurowania skrzynki. Token resetu jest wypisywany w terminalu. `ENABLE_TEST_TOKEN_ENDPOINT=true` udostępnia go dodatkowo lokalnym testom HTTP. Ten mechanizm wolno stosować wyłącznie przy serwerze uruchomionym na `127.0.0.1` w trybie `development`; w normalnym wdrożeniu ma być wyłączony.


**Plik `src/config.ts`:**

```typescript
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
```


## 4. Baza SQLite i model Sequelize

`Sequelize` jest ORM, więc operacje `create`, `findOne`, `findByPk` i `update` zostaną przetłumaczone na SQL. Zwykłe uruchomienie tworzy plik `data/auth.sqlite`; przy testach `NODE_ENV=test` jest używana osobna baza w pamięci (`:memory:`).

`sequelize.sync()` tworzy brakujące tabele. Nie używaj `sync({ force: true })` na danych, które chcesz zachować.


**Plik `src/db.ts`:**

```typescript
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
```


Model `User` przechowuje e-mail i hash hasła. `resetTokenHash` oraz `resetTokenExpiresAt` są używane podczas resetu. `email` ma ograniczenie `unique`, a `CreationOptional` wskazuje pola automatycznie wypełniane przez bazę.


**Plik `src/User.ts`:**

```typescript
import {
  Model, DataTypes, InferAttributes, InferCreationAttributes,
  CreationOptional,
} from "sequelize";
import { sequelize } from "./db";

export class User extends Model<
  InferAttributes<User>, InferCreationAttributes<User>
> {
  declare id: CreationOptional<number>;
  declare email: string;
  declare passwordHash: string;
  declare resetTokenHash: string | null;
  declare resetTokenExpiresAt: Date | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

User.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  email: { type: DataTypes.STRING(254), allowNull: false, unique: true },
  passwordHash: { type: DataTypes.STRING(255), allowNull: false },
  resetTokenHash: { type: DataTypes.STRING(64), allowNull: true },
  resetTokenExpiresAt: { type: DataTypes.DATE, allowNull: true },
  createdAt: DataTypes.DATE,
  updatedAt: DataTypes.DATE,
}, {
  sequelize,
  tableName: "users",
  timestamps: true,
});
```


## 5. Hashowanie haseł i tokeny

`hashPassword` zapisuje jednokierunkowy hash zamiast zwykłego hasła. `verifyPassword` weryfikuje hasło podczas logowania. Token resetu pochodzi z `randomBytes(32)` i jest przechowywany w bazie jedynie w postaci hasha SHA-256.


**Plik `src/security.ts`:**

```typescript
import { randomBytes, createHash } from "node:crypto";
import { hash, compare } from "bcryptjs";

export function hashPassword(plain: string) {
  return hash(plain, 10);
}

export function verifyPassword(plain: string, hashed: string) {
  return compare(plain, hashed);
}

export function newResetToken() {
  return randomBytes(32).toString("hex");
}

export function hashResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
```


## 6. Reset hasła bez poczty — tryb podstawowy

Funkcja `sendResetEmail` przy `MAIL_MODE=console` **nie łączy się z usługą pocztową**. Zapisuje token tymczasowo w pamięci procesu i wyświetla go w konsoli serwera. Umożliwia to ręczny reset i automatyczny scenariusz Bruno bez dodatkowej konfiguracji.

Przykładowy wpis w terminalu po żądaniu `forgot-password`:

```text
[RESET HASŁA] Konto: test@example.com
TOKEN=... (64 znaki szesnastkowe)
Token ważny 15 minut.
```

Przy `MAIL_MODE=smtp` ten sam plik użyje Nodemailer i parametrów z `.env`; ten wariant opisujemy osobno jako opcjonalny.


**Plik `src/email.ts`:**

```typescript
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
```


## 7. Endpointy REST API

| Metoda | Ścieżka | Poprawny status | Cel |
|---|---|---|---|
| GET | `/health` | 200 | Serwer działa |
| GET | `/health/db` | 200 | Połączenie SQLite |
| POST | `/api/auth/register` | 201 | Tworzy konto |
| POST | `/api/auth/login` | 200 | Zwraca JWT |
| GET | `/api/auth/me` | 200 | Chroniony profil |
| POST | `/api/auth/forgot-password` | 202 | Przygotowuje token resetu |
| GET | `/api/auth/dev/reset-token?email=...` | 200 | **Tylko lokalnie:** odczyt tokenu do testów |
| POST | `/api/auth/reset-password` | 200 | Zmienia hasło |

### Rejestracja

Najpierw `Zod` sprawdza typy, poprawność e-maila i długość hasła. `bcryptjs` tworzy hash, a `User.create()` zapisuje go w SQLite. Próba ponownego użycia tego samego e-maila zwraca `409 Conflict`.

### Logowanie i JWT

`User.findOne()` wyszukuje konto, `verifyPassword()` porównuje hasła, a `jwt.sign()` tworzy JWT ważny godzinę. Endpoint `/me` wymaga nagłówka `Authorization: Bearer <JWT>` i sprawdza token przez `jwt.verify()`.

### Reset hasła

`forgot-password` tworzy losowy token na 15 minut; zapisuje jego hash w bazie. `reset-password` sprawdza token i datę ważności, zmienia hash hasła, a następnie zeruje pola resetu. Ponowne użycie tokenu ma zwrócić `400`.

### Endpoint wyłącznie do testów

`GET /api/auth/dev/reset-token?email=...` jest dostępny **tylko** przy `NODE_ENV=development`, `MAIL_MODE=console` i `ENABLE_TEST_TOKEN_ENDPOINT=true`. Pozwala Bruno pobrać token bez poczty. Nie wystawiaj go do Internetu ani nie używaj w produkcji.


**Plik `src/auth.routes.ts`:**

```typescript
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
```


## 8. Podłączenie aplikacji i jej uruchomienie

`app.ts` konfiguruje `express.json()`, routing i obsługę błędów. `server.ts` łączy się z SQLite, wywołuje `sequelize.sync()` i uruchamia HTTP wyłącznie na lokalnym interfejsie `127.0.0.1`.


**Plik `src/app.ts`:**

```typescript
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
```


**Plik `src/server.ts`:**

```typescript
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
```


Uruchom:

```powershell
npm run typecheck
npm run dev
```

Odwiedź `http://127.0.0.1:3000/health` — oczekuj `{"status":"ok"}`. Otwórz `/health/db` — oczekuj `{"database":"connected"}`. Plik bazy znajdziesz w `data/auth.sqlite`.

Dla normalnej kompilacji można użyć `npm run build`, a potem `npm start`. Gdy zmieniasz pliki `.ts`, `npm run dev` automatycznie restartuje serwer.


## 9. Ręczne testowanie API w Bruno

W programie Bruno wybierz **Open Collection** i otwórz katalog `bruno/` z projektu. Włącz środowisko `local` ze zmienną `baseUrl=http://127.0.0.1:3000`.

### 9.1 Rejestracja

Utwórz `POST {{baseUrl}}/api/auth/register`, Body → JSON:

```json
{"email":"test@example.com","password":"Haslo1234!"}
```

**Oczekuj `201`** i danych `{id, email}` bez pola `passwordHash`. Powtórz żądanie z tym samym e-mailem — **oczekuj `409`**.

### 9.2 Logowanie

`POST {{baseUrl}}/api/auth/login`, JSON:

```json
{"email":"test@example.com","password":"Haslo1234!"}
```

**Oczekuj `200` i pola `token`.** Przekaż token w kolejnym żądaniu `GET /api/auth/me` przez `Authorization: Bearer <token>`. Bez nagłówka **oczekuj `401`**.

### 9.3 Reset hasła (bez wysyłania wiadomości)

Wywołaj `POST {{baseUrl}}/api/auth/forgot-password` z `{"email":"test@example.com"}`. **Oczekuj `202`**, a następnie odczytaj `TOKEN=...` z terminala albo wykonaj:

`GET {{baseUrl}}/api/auth/dev/reset-token?email=test@example.com`

Przekaż token do `POST {{baseUrl}}/api/auth/reset-password`:

```json
{"token":"TOKEN_Z_TERMINALA","newPassword":"NoweHaslo1234!"}
```

**Oczekuj `200`.** Spróbuj wykorzystać ten token ponownie — **oczekuj `400`**. Zaloguj się starym hasłem — **oczekuj `401`**. Zaloguj się nowym — **oczekuj `200`**.

### 9.4 Testy w zakładce Tests

W Bruno `res.getStatus()` zwraca kod odpowiedzi, `res.getBody()` treść JSON, a `bru.setVar(...)` zapisuje zmienną, którą można wykorzystać w następnych żądaniach. Na przykład:

```javascript
test("Logowanie zwraca JWT", () => {
  expect(res.getStatus()).to.equal(200);
  const token = res.getBody().token;
  expect(token).to.be.a("string");
  bru.setVar("jwt", token);
});
```

Wszystkie żądania wraz z asercjami są gotowymi plikami `.bru` w projekcie.


## 10. Testy jednostkowe i integracyjne — Jest

`npm test` działa bez uruchomionego serwera HTTP. Testy jednostkowe weryfikują funkcje haseł i tokenów; testy integracyjne uruchamiają Sequelize na SQLite w pamięci i weryfikują zapis, odczyt oraz ograniczenie `UNIQUE`. Nie usuwają zawartości `data/auth.sqlite`.

Konfiguracja jest przechowywana w `jest.config.cjs` i `tsconfig.test.json`.


**Plik `jest.config.cjs`:**

```javascript
module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.test.json" }],
  },
};
```


**Plik `tsconfig.test.json`:**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "./dist-test",
    "types": [
      "node",
      "jest"
    ]
  },
  "include": [
    "src/**/*.ts",
    "tests/**/*.ts"
  ]
}
```


### Testy jednostkowe: hasła i tokeny

Porównujemy hash z jawnym hasłem, sprawdzamy poprawne i błędne hasło oraz własności tokenów resetu.


**Plik `tests/security.unit.test.ts`:**

```typescript
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
```


### Testy jednostkowe: tryb lokalny

Sprawdzamy, że token można odczytać i skasować bez wysyłania żadnej wiadomości.


**Plik `tests/email.unit.test.ts`:**

```typescript
import { sendResetEmail, getLocalResetToken, clearLocalResetToken } from "../src/email";

test("Tryb console udostępnia lokalny token resetujący", async () => {
  const token = "a".repeat(64);
  const email = "testowy@example.com";
  await sendResetEmail(email, token);
  expect(getLocalResetToken(email)).toBe(token);
  clearLocalResetToken(token);
  expect(getLocalResetToken(email)).toBeUndefined();
});
```


### Testy integracyjne: Sequelize + SQLite

Przed testami `sequelize.sync({ force: true })` tworzy czystą bazę *wyłącznie w pamięci*. Sprawdzamy zapis, unikalność e-maila i termin ważności tokenu.


**Plik `tests/user.integration.test.ts`:**

```typescript
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
```


Uruchom:

```powershell
npm test
```

Jeżeli testy się nie powiodą, komunikat Jest wskaże plik, scenariusz i oczekiwaną oraz rzeczywistą wartość.


## 11. Automatyczne testy E2E — Bruno CLI

Bruno wysyła prawdziwe żądania do uruchomionego Express. Nasz scenariusz obejmuje **13 żądań w ustalonej kolejności**. Nie włączaj ich równoległego wykonywania, ponieważ zależą od zmiennych zapisanych przez poprzednie kroki.

| Kolejność | Żądanie | Wynik |
|---:|---|---:|
| 1 | Rejestracja nowego konta | 201 |
| 2 | Ponowna rejestracja tego e-maila | 409 |
| 3 | Błędne dane rejestracji | 400 |
| 4 | Logowanie | 200 + JWT |
| 5 | Profil z tokenem JWT | 200 |
| 6 | Profil bez tokenu | 401 |
| 7 | Żądanie resetu hasła | 202 |
| 8 | Lokalny odczyt tokenu resetu | 200 |
| 9 | Zmiana hasła | 200 |
| 10 | Ponowne użycie tokenu | 400 |
| 11 | Logowanie starym hasłem | 401 |
| 12 | Logowanie nowym hasłem | 200 |
| 13 | Profil po nowym logowaniu | 200 |

Żądanie nr 1 tworzy unikalny e-mail, nr 4 zapisuje `jwt`, a nr 8 zapisuje `resetToken`. Dzięki temu kolekcja może wykonywać się wielokrotnie bez ręcznego kopiowania danych.

W **pierwszym terminalu** zostaw uruchomione `npm run dev`. W **drugim** (katalog główny projektu) wykonaj:

```powershell
npm run test:api
```

Po zakończeniu sprawdź `bruno-report.html`. Bruno CLI zwróci błąd, jeśli asercja zakończy się niepowodzeniem.

**Najważniejsza zmiana:** żądanie nr 8 nie łączy się z pocztą — pobiera token z **lokalnego endpointu testowego**. Wszystkie pliki `.bru` zostały dołączone do archiwum.


### Pliki Bruno — gotowy kod do uruchomienia

Poniżej znajdują się rzeczywiste pliki kolekcji. Możesz je otworzyć w Bruno lub uruchomić CLI, bez przepisywania.


**Plik `bruno/bruno.json`:**

```json
{
  "version": "1",
  "name": "Auth API - rejestracja, JWT, reset i testy",
  "type": "collection",
  "ignore": [
    "node_modules",
    ".git"
  ]
}
```


**Plik `bruno/environments/local.bru`:**

```text
vars {
  baseUrl: http://127.0.0.1:3000
}
```


**Plik `bruno/01-Rejestracja.bru`:**

```javascript
meta {
  name: Rejestracja
  type: http
  seq: 1
}

post {
  url: {{baseUrl}}/api/auth/register
  body: json
  auth: none
}

body:json {
  {
    "email": "{{email}}",
    "password": "Haslo1234!"
  }
}

script:pre-request {
  bru.setVar("email", `lab-${Date.now()}-${Math.floor(Math.random() * 1e7)}@example.com`);
}

tests {
  test("201, konto utworzone, brak hasła w odpowiedzi", () => {
    expect(res.getStatus()).to.equal(201);
    const b = res.getBody();
    expect(b.email).to.equal(bru.getVar("email"));
    expect(b).to.not.have.property("passwordHash");
  });
}
```


**Plik `bruno/02-Duplikat.bru`:**

```javascript
meta {
  name: Duplikat
  type: http
  seq: 2
}

post {
  url: {{baseUrl}}/api/auth/register
  body: json
  auth: none
}

body:json {
  {
    "email": "{{email}}",
    "password": "Haslo1234!"
  }
}

tests {
  test("409, drugi taki sam email jest odrzucany", () => {
    expect(res.getStatus()).to.equal(409);
  });
}
```


**Plik `bruno/03-Nieprawidlowe-dane.bru`:**

```javascript
meta {
  name: Nieprawidlowe-dane
  type: http
  seq: 3
}

post {
  url: {{baseUrl}}/api/auth/register
  body: json
  auth: none
}

body:json {
  {
    "email": "niepoprawny-email",
    "password": "123"
  }
}

tests {
  test("400 dla nieprawidłowych danych", () => {
    expect(res.getStatus()).to.equal(400);
  });
}
```


**Plik `bruno/04-Logowanie.bru`:**

```javascript
meta {
  name: Logowanie
  type: http
  seq: 4
}

post {
  url: {{baseUrl}}/api/auth/login
  body: json
  auth: none
}

body:json {
  {
    "email": "{{email}}",
    "password": "Haslo1234!"
  }
}

tests {
  test("200 i token JWT", () => {
    expect(res.getStatus()).to.equal(200);
    const b = res.getBody();
    expect(b.token).to.be.a("string");
    bru.setVar("jwt", b.token);
  });
}
```


**Plik `bruno/05-Profil.bru`:**

```javascript
meta {
  name: Profil
  type: http
  seq: 5
}

get {
  url: {{baseUrl}}/api/auth/me
  body: none
  auth: none
}

headers {
  Authorization: Bearer {{jwt}}
}

tests {
  test("200, profil zalogowanego użytkownika", () => {
    expect(res.getStatus()).to.equal(200);
    expect(res.getBody().email).to.equal(bru.getVar("email"));
  });
}
```


**Plik `bruno/06-Profil-bez-tokena.bru`:**

```javascript
meta {
  name: Profil-bez-tokena
  type: http
  seq: 6
}

get {
  url: {{baseUrl}}/api/auth/me
  body: none
  auth: none
}

tests {
  test("401 gdy brakuje nagłówka Authorization", () => {
    expect(res.getStatus()).to.equal(401);
  });
}
```


**Plik `bruno/07-Zapomniane-haslo.bru`:**

```javascript
meta {
  name: Zapomniane-haslo
  type: http
  seq: 7
}

post {
  url: {{baseUrl}}/api/auth/forgot-password
  body: json
  auth: none
}

body:json {
  {
    "email": "{{email}}"
  }
}

tests {
  test("202, potwierdzenie bez ujawniania istnienia konta", () => {
    expect(res.getStatus()).to.equal(202);
  });
}
```


**Plik `bruno/08-Odczytaj-token.bru`:**

```javascript
meta {
  name: Odczytaj-token-lokalny
  type: http
  seq: 8
}

get {
  url: {{baseUrl}}/api/auth/dev/reset-token?email={{email}}
  body: none
  auth: none
}

tests {
  test("Lokalny endpoint zwraca token resetu", () => {
    expect(res.getStatus()).to.equal(200);
    const token = res.getBody().token;
    expect(token).to.match(/^[a-f0-9]{64}$/);
    bru.setVar("resetToken", token);
  });
}
```


**Plik `bruno/09-Reset-hasla.bru`:**

```javascript
meta {
  name: Reset-hasla
  type: http
  seq: 9
}

post {
  url: {{baseUrl}}/api/auth/reset-password
  body: json
  auth: none
}

body:json {
  {
    "token": "{{resetToken}}",
    "newPassword": "NoweHaslo1234!"
  }
}

tests {
  test("200, hasło zmienione", () => {
    expect(res.getStatus()).to.equal(200);
  });
}
```


**Plik `bruno/10-Token-uzyty-ponownie.bru`:**

```javascript
meta {
  name: Token-uzyty-ponownie
  type: http
  seq: 10
}

post {
  url: {{baseUrl}}/api/auth/reset-password
  body: json
  auth: none
}

body:json {
  {
    "token": "{{resetToken}}",
    "newPassword": "JeszczeInneHaslo1234!"
  }
}

tests {
  test("Ten sam token nie działa drugi raz", () => {
    expect(res.getStatus()).to.equal(400);
  });
}
```


**Plik `bruno/11-Stare-haslo.bru`:**

```javascript
meta {
  name: Stare-haslo
  type: http
  seq: 11
}

post {
  url: {{baseUrl}}/api/auth/login
  body: json
  auth: none
}

body:json {
  {
    "email": "{{email}}",
    "password": "Haslo1234!"
  }
}

tests {
  test("401, stare hasło nie działa", () => {
    expect(res.getStatus()).to.equal(401);
  });
}
```


**Plik `bruno/12-Nowe-haslo.bru`:**

```javascript
meta {
  name: Nowe-haslo
  type: http
  seq: 12
}

post {
  url: {{baseUrl}}/api/auth/login
  body: json
  auth: none
}

body:json {
  {
    "email": "{{email}}",
    "password": "NoweHaslo1234!"
  }
}

tests {
  test("200, nowe hasło działa", () => {
    expect(res.getStatus()).to.equal(200);
    expect(res.getBody().token).to.be.a("string");
    bru.setVar("jwt", res.getBody().token);
  });
}
```


**Plik `bruno/13-Profil-po-ponownym-logowaniu.bru`:**

```javascript
meta {
  name: Profil-po-ponownym-logowaniu
  type: http
  seq: 13
}

get {
  url: {{baseUrl}}/api/auth/me
  body: none
  auth: none
}

headers {
  Authorization: Bearer {{jwt}}
}

tests {
  test("Nowy JWT daje dostęp do profilu", () => {
    expect(res.getStatus()).to.equal(200);
    expect(res.getBody().email).to.equal(bru.getVar("email"));
  });
}
```


## 12. * Opcjonalnie — prawdziwa wysyłka e-mail przez SMTP

Wysyłka na prawdziwą skrzynkę **nie jest potrzebna do uruchomienia serwera ani testów**. Jeśli masz dostęp do serwera SMTP, możesz ją włączyć bez zmian w kodzie.

W `.env` ustaw odpowiednie wartości od dostawcy poczty:

```dotenv
MAIL_MODE=smtp
ENABLE_TEST_TOKEN_ENDPOINT=false
SMTP_HOST=smtp.twoj-dostawca.pl
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=twoj-login
SMTP_PASS=haslo-aplikacji-lub-dane-smtp
MAIL_FROM=Auth API <zweryfikowany-adres@example.com>
```

Zrestartuj serwer i wywołaj `POST /api/auth/forgot-password` dla konta z prawdziwym e-mailem. Nodemailer przekaże wiadomość do skonfigurowanego serwera SMTP. Dostarczenie wiadomości zależy od dostawcy. Nie umieszczaj haseł SMTP w repozytorium.

**Uwaga:** pełny automatyczny scenariusz Bruno (żądanie nr 8) jest przeznaczony dla `MAIL_MODE=console`. Po włączeniu SMTP wyłączony zostanie lokalny endpoint odczytu tokenu. Wariant z prawdziwą skrzynką testuj ręcznie lub skonfiguruj dedykowaną skrzynkę testową i jej API.


## 13. Uruchomienie — skrót i typowe problemy

```powershell
Copy-Item .env.example .env
npm install
# Wpisz wygenerowany JWT_SECRET do .env
npm run typecheck
npm run dev
```

W drugim terminalu:

```powershell
npm test
npm run test:api
```

| Problem | Co sprawdzić |
|---|---|
| `JWT_SECRET musi mieć co najmniej 32 znaki` | Wygeneruj i wpisz sekret do `.env` |
| Nie ma pliku SQLite | Otwórz `/health/db`, sprawdź `data/auth.sqlite` i `DB_FILE` |
| `401` przy `/me` | Nagłówek `Authorization: Bearer <JWT>` |
| Test resetu zwraca `404` | `MAIL_MODE=console`, `NODE_ENV=development`, `ENABLE_TEST_TOKEN_ENDPOINT=true` |
| Bruno nie łączy się z API | Serwer działa na `127.0.0.1:3000`, środowisko `local` w Bruno |
| Ponowna rejestracja zwraca `409` | To poprawny wynik dla duplikatu e-maila |
| SMTP nie dostarcza wiadomości (*) | Zweryfikuj host, port, TLS, poświadczenia, nadawcę i ograniczenia dostawcy |

**Uwagi bezpieczeństwa:** ten projekt jest lokalnym przykładem serwera. Przy wystawianiu go publicznie należy wyłączyć endpoint testowy, dodać rate limiting, HTTPS, migracje, obsługę niedostępności SMTP i unieważnianie sesji JWT po resecie hasła.
