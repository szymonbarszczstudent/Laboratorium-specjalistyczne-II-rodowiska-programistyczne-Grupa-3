import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';

const app = express();
const PORT = process.env.PORT || 3000;

const dbDir = path.resolve(__dirname, '../data');
const dbPath = path.join(dbDir, 'users.db');

fs.mkdirSync(dbDir, { recursive: true });

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Błąd połączenia z bazą danych:', err.message);
    return;
  }

  db.run(
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE
    )`,
    (createErr) => {
      if (createErr) {
        console.error('Błąd tworzenia tabeli:', createErr.message);
      } else {
        console.log('Tabela users gotowa.');
      }
    }
  );
});

app.use(express.json());

app.get('/getAllUsers', (_req: Request, res: Response) => {
  db.all('SELECT id, name, email FROM users ORDER BY id', (err, rows) => {
    if (err) {
      res.status(500).json({ error: 'Błąd pobierania użytkowników', details: err.message });
      return;
    }

    res.status(200).json(rows);
  });
});

app.post('/addUser', (req: Request, res: Response) => {
  const { name, email } = req.body as { name?: string; email?: string };

  if (!name || !email) {
    res.status(400).json({ error: 'Pole name i email są wymagane.' });
    return;
  }

  db.run(
    'INSERT INTO users (name, email) VALUES (?, ?)',
    [name, email],
    function (err) {
      if (err) {
        res.status(400).json({ error: 'Nie udało się dodać użytkownika', details: err.message });
        return;
      }

      res.status(201).json({
        id: this.lastID,
        name,
        email,
      });
    }
  );
});

app.listen(PORT, () => {
  console.log(`Serwer działa na http://localhost:${PORT}`);
});
