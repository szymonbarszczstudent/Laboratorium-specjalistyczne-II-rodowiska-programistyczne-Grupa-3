# Auth API — Node.js + Express + TypeScript + SQLite + testy

Serwer REST API: rejestracja, logowanie JWT, profil użytkownika i jednorazowy reset hasła.
**Wszystko uruchamia się lokalnie bez dodatkowych usług.** Domyślnie token resetu jest wyświetlany w terminalu. Opcjonalna wysyłka na prawdziwy adres e-mail dostępna przez SMTP (sekcja z gwiazdką).

## Szybki start (PowerShell)

```powershell
Copy-Item .env.example .env
npm install
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Wklej wygenerowany klucz do `JWT_SECRET` w `.env`, a następnie:

```powershell
npm run typecheck
npm run dev
```

Otwórz `http://127.0.0.1:3000/health`.

## Testowanie

W drugim terminalu, podczas gdy serwer działa:

```powershell
npm test
npm run test:api
```

- `npm test` — testy jednostkowe (hasła, tokeny, tryb console) i integracyjne (Sequelize + SQLite w pamięci).
- `npm run test:api` — 13 kolejnych żądań Bruno CLI: rejestracja, duplikat, walidacja, logowanie, JWT, reset hasła i ponowne logowanie. Raport: `bruno-report.html`.
- W Bruno GUI wybierz **Open Collection**, katalog `bruno/`, środowisko `local`. Pliki `.bru` to rzeczywiste testy do uruchomienia.

W trybie `MAIL_MODE=console` po wywołaniu `POST /api/auth/forgot-password` token można zobaczyć w terminalu. Lokalny endpoint `GET /api/auth/dev/reset-token?email=...` służy **wyłącznie do automatyzacji testów**. Działa tylko dla `NODE_ENV=development`, `MAIL_MODE=console` i `ENABLE_TEST_TOKEN_ENDPOINT=true`; serwer jest dostępny tylko pod `127.0.0.1`. **Nie włączaj tego endpointu na serwerze publicznym.**

## * Opcjonalnie: prawdziwa wysyłka e-mail przez SMTP

Jeśli masz konto i dane SMTP, ustaw w `.env`:

```dotenv
MAIL_MODE=smtp
ENABLE_TEST_TOKEN_ENDPOINT=false
SMTP_HOST=smtp.twoj-dostawca.pl
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=twoj-login
SMTP_PASS=twoje-haslo-aplikacji
MAIL_FROM=Auth API <zweryfikowany-adres@example.com>
```

Następnie zrestartuj `npm run dev` i wywołaj `POST /api/auth/forgot-password` dla konta z prawdziwym adresem e-mail. Nodemailer wyśle wiadomość przez skonfigurowany serwer SMTP. **Test Bruno pobierający token lokalnie (nr 8) działa tylko w trybie console**, więc do automatyzacji całego zestawu przywróć `MAIL_MODE=console`.

## Instrukcja

Cały kod i opis testowania krok po kroku znajdują się w `INSTRUKCJA-KROK-PO-KROKU.md` oraz dołączonym PDF.
