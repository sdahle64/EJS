-- Denne SQL-filen definerer databasen og tabellen for brukere.

-- Oppretter tabellen "users" hvis den ikke allerede finnes.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,        -- Unik ID for hver bruker (auto-inkrement)
  email TEXT UNIQUE NOT NULL,                  -- Brukerens e-post, må være unik og kan ikke være NULL
  password_hash TEXT NOT NULL,                 -- Hash av passordet (ikke i klartekst)
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP -- Tidspunkt for når brukeren ble opprettet
);

-- Oppretter en indeks på email for raskere oppslag under innlogging.
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);