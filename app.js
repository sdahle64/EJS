// Importerer innebygd 'path' for filstihåndtering
const path = require('path'); // Brukes til å sette opp stier til views og public

// Importerer Express-rammeverket
const express = require('express'); // Lar oss lage server, ruter og middleware

// Importerer bcrypt for hashing av passord
const bcrypt = require('bcrypt'); // Sikrer passord ved å lagre hash i stedet for klartekst

// Importerer express-session for å håndtere innloggingssesjoner
const session = require('express-session'); // Brukes for å holde brukeren innlogget på tvers av forespørsler

// Importerer sqlite3 og aktiverer verbose logging (nyttig for debugging)
const sqlite3 = require('sqlite3').verbose(); // SQLite-driver for Node, enkel lokal database

// Oppretter en Express-app
const app = express(); // Initialiserer Express-applikasjonen

// Definerer portnummer for serveren
const PORT = 3000; // Porten som serveren vil lytte på

// Oppretter/åpner en SQLite-databasefil kalt 'app.db'
const db = new sqlite3.Database(path.join(__dirname, 'app.db')); // Oppretter/åpner databasefil i prosjektmappen

// Slår på fremmednøkler i SQLite
db.serialize(() => { // Kjører SQL i rekkefølge som definert
  db.run('PRAGMA foreign_keys = ON'); // Sikrer at FK-regler håndheves (sletting osv.)
}); // Avslutter serialize-blokk

// Oppretter tabeller hvis de ikke finnes fra før
db.serialize(() => { // Kjører opprettelses-spørringer i rekkefølge
  // Oppretter 'users'-tabellen om den ikke finnes
  db.run(`
    CREATE TABLE IF NOT EXISTS users (       -- Lager en tabell for brukere hvis den ikke finnes
      id INTEGER PRIMARY KEY AUTOINCREMENT,  -- Primærnøkkel, autoincrement
      username TEXT UNIQUE NOT NULL,         -- Unikt brukernavn, påkrevd
      password_hash TEXT NOT NULL            -- Hash av passord (bcrypt), påkrevd
    )
  `); // Avslutter CREATE TABLE for users

  // Oppretter 'songs'-tabellen om den ikke finnes
  db.run(`
    CREATE TABLE IF NOT EXISTS songs (        -- Lager en tabell for sanger hvis den ikke finnes
      id INTEGER PRIMARY KEY AUTOINCREMENT,   -- Primærnøkkel, autoincrement
      title TEXT NOT NULL,                    -- Sangen sin tittel, påkrevd
      artist TEXT NOT NULL,                   -- Artistnavn, påkrevd
      listened_date TEXT NOT NULL,            -- Dato som tekst (format YYYY-MM-DD), påkrevd
      user_id INTEGER NOT NULL,               -- Henviser til brukeren som eier sangen
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE -- FK med kaskadesletting
    )
  `); // Avslutter CREATE TABLE for songs
}); // Avslutter serialize-blokk for opprettelse

// Lager små hjelpefunksjoner for å bruke Promises/async-await med sqlite3
function dbRun(sql, params = []) { // Definerer en funksjon for INSERT/UPDATE/DELETE
  return new Promise((resolve, reject) => { // Returnerer et Promise
    db.run(sql, params, function (err) { // Kjører spørringen med parametere
      if (err) return reject(err); // Avviser promise hvis feil oppstår
      resolve(this); // Løser promise med 'this' (som har lastID/changes)
    }); // Avslutter db.run
  }); // Avslutter Promise
} // Avslutter dbRun

function dbGet(sql, params = []) { // Definerer en funksjon for å hente én rad
  return new Promise((resolve, reject) => { // Returnerer et Promise
    db.get(sql, params, function (err, row) { // Kjører spørring som forventer en rad
      if (err) return reject(err); // Avviser ved feil
      resolve(row); // Løser med funnet rad (eller undefined hvis ingen)
    }); // Avslutter db.get
  }); // Avslutter Promise
} // Avslutter dbGet

function dbAll(sql, params = []) { // Definerer en funksjon for å hente flere rader
  return new Promise((resolve, reject) => { // Returnerer et Promise
    db.all(sql, params, function (err, rows) { // Kjører spørring som returnerer flere rader
      if (err) return reject(err); // Avviser ved feil
      resolve(rows); // Løser med en array av rader
    }); // Avslutter db.all
  }); // Avslutter Promise
} // Avslutter dbAll

// Konfigurerer EJS som templatemotor
app.set('view engine', 'ejs'); // Forteller Express at .ejs-filer skal rendre visninger

// Angir stien til mappen som inneholder EJS-visninger
app.set('views', path.join(__dirname, 'views')); // Sikrer korrekt sti til 'views'

// Serverer statiske filer (CSS, bilder, klient-js) fra 'public'-mappen
app.use(express.static(path.join(__dirname, 'public'))); // Gjør public/ tilgjengelig via URL

// Middleware for å tolke URL-enkodede skjema (application/x-www-form-urlencoded)
app.use(express.urlencoded({ extended: true })); // Gjør req.body tilgjengelig fra HTML-skjema

// Middleware for å tolke JSON-body (for API-endepunkter)
app.use(express.json()); // Gjør req.body tilgjengelig for JSON-kall

// Konfigurerer sesjoner (kun minnelager – ok for utvikling)
app.use(session({ // Setter opp express-session
  secret: 'dev-secret-bytt-denne-i-produksjon', // Hemmelig nøkkel for å signere session-ID
  resave: false, // Ikke lagre sesjonen på nytt hvis den ikke er endret
  saveUninitialized: false, // Ikke lagre "tomme" sesjoner
  cookie: { secure: false } // secure=false fordi vi kjører på http i utvikling
})); // Avslutter session-konfig

// Middleware som eksponerer innlogget bruker til EJS-maler
app.use(async (req, res, next) => { // Definerer en middleware
  res.locals.currentUser = req.session.user || null; // Legger inn brukerinfo i res.locals for enkel tilgang i EJS
  next(); // Går videre til neste middleware/rute
}); // Avslutter middleware

// Hjelpemiddleware for å kreve innlogging for visse ruter
function requireAuth(req, res, next) { // Definerer en auth-guard
  if (!req.session.user) { // Sjekker om det ikke finnes innlogget bruker
    return res.status(401).send('Du må være innlogget.'); // Returnerer 401 hvis ikke logget inn
  } // Avslutter sjekk
  next(); // Fortsetter hvis innlogget
} // Avslutter requireAuth

// Hjemmeside: viser skjemaer og sangliste
app.get('/', async (req, res) => { // Definerer GET for rot-URL
  try { // Starter feilhandtering
    let songs = []; // Forbereder en tom liste for sanger
    if (req.session.user) { // Sjekker om bruker er innlogget
      songs = await dbAll( // Henter sanger som tilhører innlogget bruker
        'SELECT id, title, artist, listened_date FROM songs WHERE user_id = ? ORDER BY listened_date DESC, id DESC', // SQL for å liste sanger
        [req.session.user.id] // Parametere: user_id fra sesjonen
      ); // Avslutter henting av sanger
    } // Avslutter innloggingssjekk
    res.render('index', { title: 'Mine sanger', songs, message: null }); // Renderer index med tittel, sanger og ingen melding
  } catch (err) { // Fanger eventuelle feil
    console.error(err); // Logger feilen til konsollen
    res.status(500).send('Noe gikk galt.'); // Sender enkel feilrespons
  } // Avslutter try/catch
}); // Avslutter GET /

// Registrering via HTML-skjema (bruker bcrypt)
app.post('/register', async (req, res) => { // Definerer POST /register
  try { // Starter feilhandtering
    const { username, password } = req.body; // Leser brukernavn og passord fra skjema
    if (!username || !password) { // Validerer at begge felter finnes
      return res.status(400).render('index', { title: 'Mine sanger', songs: [], message: 'Fyll ut alle felt for registrering.' }); // Viser feilmelding
    } // Avslutter validering
    const existing = await dbGet('SELECT id FROM users WHERE username = ?', [username]); // Sjekker om brukernavn er opptatt
    if (existing) { // Hvis brukernavnet allerede finnes
      return res.status(409).render('index', { title: 'Mine sanger', songs: [], message: 'Brukernavn er opptatt.' }); // Gir beskjed
    } // Avslutter duplikat-sjekk
    const hash = await bcrypt.hash(password, 12); // Hasher passordet med cost-factor 12
    const result = await dbRun('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, hash]); // Lagrer brukeren i DB
    req.session.user = { id: result.lastID, username }; // Lagrer brukerinfo i sesjonen
    res.redirect('/'); // Sender brukeren til forsiden etter registrering
  } catch (err) { // Fanger feil
    console.error(err); // Logger feil
    res.status(500).render('index', { title: 'Mine sanger', songs: [], message: 'Kunne ikke registrere. Prøv igjen.' }); // Viser feilmelding
  } // Avslutter try/catch
}); // Avslutter POST /register

// Innlogging via HTML-skjema (sjekker bcrypt-hash)
app.post('/login', async (req, res) => { // Definerer POST /login
  try { // Starter feilhandtering
    const { username, password } = req.body; // Leser felt fra skjema
    if (!username || !password) { // Sjekker at feltene finnes
      return res.status(400).render('index', { title: 'Mine sanger', songs: [], message: 'Fyll ut alle felt for innlogging.' }); // Feilmelding
    } // Avslutter validering
    const user = await dbGet('SELECT id, username, password_hash FROM users WHERE username = ?', [username]); // Henter bruker
    if (!user) { // Hvis ingen bruker funnet
      return res.status(401).render('index', { title: 'Mine sanger', songs: [], message: 'Feil brukernavn eller passord.' }); // Feilmelding
    } // Avslutter brukerfinn-sjekk
    const ok = await bcrypt.compare(password, user.password_hash); // Sammenligner passord med lagret hash
    if (!ok) { // Hvis passordet ikke stemmer
      return res.status(401).render('index', { title: 'Mine sanger', songs: [], message: 'Feil brukernavn eller passord.' }); // Feilmelding
    } // Avslutter passordsjekk
    req.session.user = { id: user.id, username: user.username }; // Lagrer innlogget bruker i sesjon
    res.redirect('/'); // Går til forsiden ved suksess
  } catch (err) { // Fanger feil
    console.error(err); // Logger feil
    res.status(500).render('index', { title: 'Mine sanger', songs: [], message: 'Innlogging feilet. Prøv igjen.' }); // Feilmelding
  } // Avslutter try/catch
}); // Avslutter POST /login

// Utlogging via HTML-skjema
app.post('/logout', (req, res) => { // Definerer POST /logout
  req.session.destroy(() => { // Ødelegger sesjonen
    res.redirect('/'); // Sender brukeren til forsiden
  }); // Avslutter destroy-callback
}); // Avslutter POST /logout

// Legg til sang via HTML-skjema (krever innlogging)
app.post('/songs', requireAuth, async (req, res) => { // Definerer POST /songs med auth-guard
  try { // Starter feilhandtering
    const { title, artist, listened_date } = req.body; // Leser felter fra skjema
    if (!title || !artist || !listened_date) { // Sjekker at alle felt er oppgitt
      return res.status(400).render('index', { title: 'Mine sanger', songs: [], message: 'Fyll ut tittel, artist og dato.' }); // Feilmelding
    } // Avslutter validering
    if (!/^\d{4}-\d{2}-\d{2}$/.test(listened_date)) { // Validerer datoformat YYYY-MM-DD
      return res.status(400).render('index', { title: 'Mine sanger', songs: [], message: 'Dato må være i format YYYY-MM-DD.' }); // Feilmelding
    } // Avslutter datoformat-sjekk
    await dbRun( // Kjører en INSERT for sang
      'INSERT INTO songs (title, artist, listened_date, user_id) VALUES (?, ?, ?, ?)', // SQL med parametere
      [title.trim(), artist.trim(), listened_date, req.session.user.id] // Verdier fra skjema og sesjon
    ); // Avslutter INSERT
    res.redirect('/'); // Går tilbake til forsiden etter lagring
  } catch (err) { // Fanger feil
    console.error(err); // Logger feil
    res.status(500).render('index', { title: 'Mine sanger', songs: [], message: 'Kunne ikke lagre sangen.' }); // Feilmelding
  } // Avslutter try/catch
}); // Avslutter POST /songs

// API: Hent innlogget brukers sanger som JSON (valgfritt, nyttig for videre arbeid)
app.get('/api/songs', requireAuth, async (req, res) => { // Definerer GET /api/songs
  try { // Starter feilhandtering
    const songs = await dbAll( // Henter alle sanger for brukeren
      'SELECT id, title, artist, listened_date FROM songs WHERE user_id = ? ORDER BY listened_date DESC, id DESC', // SQL-spørring
      [req.session.user.id] // Param: current user id
    ); // Avslutter dbAll
    res.json({ songs }); // Returnerer JSON med sangene
  } catch (err) { // Fanger feil
    console.error(err); // Logger feil
    res.status(500).json({ error: 'Kunne ikke hente sanger' }); // Returnerer feil i JSON
  } // Avslutter try/catch
}); // Avslutter GET /api/songs

// API: Legg til sang via JSON (valgfritt, parallell til HTML-skjema)
app.post('/api/songs', requireAuth, async (req, res) => { // Definerer POST /api/songs
  try { // Starter feilhandtering
    const { title, artist, listened_date } = req.body; // Leser felt fra JSON-body
    if (!title || !artist || !listened_date) { // Sjekker at alle felt finnes
      return res.status(400).json({ error: 'Mangler title, artist eller listened_date' }); // 400 ved mangler
    } // Avslutter validering
    if (!/^\d{4}-\d{2}-\d{2}$/.test(listened_date)) { // Validerer datoformat
      return res.status(400).json({ error: 'Dato må være YYYY-MM-DD' }); // 400 ved feil format
    } // Avslutter datoformat-sjekk
    const result = await dbRun( // Kjører INSERT
      'INSERT INTO songs (title, artist, listened_date, user_id) VALUES (?, ?, ?, ?)', // SQL
      [title.trim(), artist.trim(), listened_date, req.session.user.id] // Parametere
    ); // Avslutter dbRun
    res.status(201).json({ ok: true, id: result.lastID }); // Returnerer suksess med ny id
  } catch (err) { // Fanger feil
    console.error(err); // Logger feil
    res.status(500).json({ error: 'Kunne ikke lagre sangen' }); // 500 ved uventet feil
  } // Avslutter try/catch
}); // Avslutter POST /api/songs

// Starter serveren
app.listen(PORT, () => { // Ber Express lytte på valgt port
  console.log(`Server kjører på http://localhost:${PORT}`); // Logger hvor du kan åpne siden
}); // Avslutter app.listen