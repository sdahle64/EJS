// Importerer innebygget 'path' for å håndtere filstier
const path = require('path');
// Importerer Express for å sette opp HTTP-server og ruter
const express = require('express');
// Importerer sqlite3 for å jobbe med SQLite-databasen
const sqlite3 = require('sqlite3').verbose();
// Importerer bcrypt for hashing av passord med salt
const bcrypt = require('bcrypt');
// Importerer express-session for enkel sesjonshåndtering (kun for utvikling)
const session = require('express-session');

// Oppretter en ny Express-app
const app = express();
// Definerer hvilken port serveren skal kjøre på (3000 som standard)
const PORT = process.env.PORT || 3000;
// Definerer hvor mange salt-runder bcrypt skal bruke (12 er et godt utgangspunkt)
const SALT_ROUNDS = 12;

// Oppretter en tilkobling til en SQLite-databasefil kalt "app.db"
const db = new sqlite3.Database(path.join(__dirname, 'app.db'));

// Kjører en initialisering for å sikre at tabellen finnes
db.serialize(() => {
  // Leser inn SQL-skjemaet fra schema.sql
  const fs = require('fs'); // Importerer fs for å lese filer
  const schemaPath = path.join(__dirname, 'db', 'schema.sql'); // Bygger sti til schema.sql
  const schemaSQL = fs.readFileSync(schemaPath, 'utf8'); // Leser hele filen som tekst
  db.exec(schemaSQL); // Kjører SQL-skjemaet i databasen
});

// Forteller Express at vi bruker EJS som templatemotor
app.set('view engine', 'ejs');
// Setter mappen "views" som base for EJS-filer
app.set('views', path.join(__dirname, 'views'));

// Legger til middleware for å parse URL-enkodede skjemaer (fra <form>)
app.use(express.urlencoded({ extended: true }));
// Serverer statiske filer (CSS, bilder) fra mappen "public"
app.use(express.static(path.join(__dirname, 'public')));

// Setter opp sesjoner (OBS: Ikke bruk MemoryStore i produksjon)
app.use(
  session({
    secret: 'dev-session-secret', // Hemmelig nøkkel for å signere sesjonscookies (bytt i produksjon)
    resave: false,                // Ikke resav sesjonen om ingenting endres
    saveUninitialized: false,     // Ikke lag sesjon før noe settes i den
    cookie: {                     // Konfigurerer cookie-egenskaper
      httpOnly: true,             // Hindrer JS i å lese cookie (XSS-beskyttelse)
      secure: false,              // true krever HTTPS (sett til true i produksjon)
      maxAge: 1000 * 60 * 60 * 8  // Setter levetiden til 8 timer
    }
  })
);

// Liten hjelpefunksjon/middleware som sikrer at bruker er innlogget
function ensureAuthenticated(req, res, next) {
  // Sjekker om vi har en userId i sesjonen
  if (req.session && req.session.userId) {
    // Går videre om bruker er innlogget
    return next();
  }
  // Hvis ikke, sendes bruker til login-siden
  return res.redirect('/login?error=Du+m%C3%A5+logge+inn+f%C3%B8rst');
}

// Rute: Hjem — videresender til dashboard hvis innlogget, ellers til login
app.get('/', (req, res) => {
  // Hvis bruker er innlogget, send til dashboard
  if (req.session && req.session.userId) {
    return res.redirect('/dashboard');
  }
  // Hvis ikke innlogget, send til login-siden
  return res.redirect('/login');
});

// Rute: Registreringsskjema (GET)
app.get('/register', (req, res) => {
  // Leser eventuelle feilmeldinger eller suksessmeldinger fra querystring
  const error = req.query.error || null;   // Feilmelding
  const success = req.query.success || null; // Suksessmelding
  // Renderer EJS-templaten for registrering med meldinger
  return res.render('register', { error, success });
});

// Rute: Håndterer innsending av registreringsskjema (POST)
app.post('/register', async (req, res) => {
  // Leser ut e-post og passord fra skjemaet
  const { email, password } = req.body;

  // Enkel validering av input
  if (!email || !password) {
    // Mangler felt — send feilmelding
    return res.redirect('/register?error=Vennligst+fyll+inn+alle+feltene');
  }
  // Sjekker minimumspassordlengde (anbefalt >= 8)
  if (password.length < 8) {
    // For kort passord — send feilmelding
    return res.redirect('/register?error=Passordet+m%C3%A5+v%C3%A6re+minst+8+tegn');
  }

  try {
    // Sjekker om e-post allerede finnes i databasen
    db.get('SELECT id FROM users WHERE email = ?', [email], async (err, row) => {
      // Håndterer databasefeil
      if (err) {
        // Logger feil i serverkonsollen
        console.error('DB-feil under oppslag av e-post:', err);
        // Sender generell feilmelding til bruker
        return res.redirect('/register?error=En+feil+oppstod.+Pr%C3%B8v+igjen');
      }

      // Hvis e-posten allerede finnes
      if (row) {
        // Returnerer feilmelding
        return res.redirect('/register?error=E-posten+er+allerede+i+bruk');
      }

      try {
        // Hasher passordet med bcrypt og SALT_ROUNDS
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

        // Setter inn ny bruker i databasen med parameteriserte verdier (hindrer SQL-injeksjon)
        db.run(
          'INSERT INTO users (email, password_hash) VALUES (?, ?)',
          [email, passwordHash],
          function (insertErr) {
            // Håndterer eventuelle feil ved innsetting
            if (insertErr) {
              console.error('DB-feil ved opprettelse av bruker:', insertErr);
              return res.redirect('/register?error=Kunne+ikke+opprette+bruker');
            }
            // Vellykket opprettelse — send bruker til login med beskjed
            return res.redirect('/login?success=Bruker+opprettet.+Logg+inn');
          }
        );
      } catch (hashErr) {
        // Fanger opp feil ved hashing
        console.error('Hash-feil:', hashErr);
        return res.redirect('/register?error=En+feil+oppstod+ved+hashing');
      }
    });
  } catch (outerErr) {
    // Ekstra sikkerhet — fanger uventede feil
    console.error('Uventet feil i register:', outerErr);
    return res.redirect('/register?error=Uventet+feil');
  }
});

// Rute: Login-skjema (GET)
app.get('/login', (req, res) => {
  // Leser feilmelding eller suksessmelding fra querystring
  const error = req.query.error || null;    // Feilmelding hvis noen
  const success = req.query.success || null; // Suksessmelding hvis noen
  // Renderer login-siden med meldinger
  return res.render('login', { error, success });
});

// Rute: Håndterer innsending av login-skjema (POST)
app.post('/login', (req, res) => {
  // Leser ut e-post og passord fra skjemaet
  const { email, password } = req.body;

  // Enkel validering
  if (!email || !password) {
    // Melding hvis felt mangler
    return res.redirect('/login?error=Vennligst+fyll+inn+e-post+og+passord');
  }

  // Slår opp bruker i databasen basert på e-post
  db.get('SELECT id, email, password_hash FROM users WHERE email = ?', [email], async (err, user) => {
    // Håndterer databasefeil
    if (err) {
      console.error('DB-feil ved innlogging:', err);
      return res.redirect('/login?error=En+feil+oppstod.+Pr%C3%B8v+igjen');
    }

    // Hvis ingen bruker funnet
    if (!user) {
      return res.redirect('/login?error=Feil+e-post+eller+passord');
    }

    try {
      // Sammenligner oppgitt passord med hash lagret i databasen
      const match = await bcrypt.compare(password, user.password_hash);

      // Hvis passord matcher
      if (match) {
        // Lagre brukerens ID i sesjonen for å holde brukeren innlogget
        req.session.userId = user.id;
        // Videresend til dashboard
        return res.redirect('/dashboard');
      } else {
        // Passord stemmer ikke — gi generisk feil
        return res.redirect('/login?error=Feil+e-post+eller+passord');
      }
    } catch (compareErr) {
      // Fanger opp uventede feil under sammenligning
      console.error('Feil ved passordsjekk:', compareErr);
      return res.redirect('/login?error=En+feil+oppstod+ved+innlogging');
    }
  });
});

// Rute: Dashboard (kun for innloggede brukere)
app.get('/dashboard', ensureAuthenticated, (req, res) => {
  // Henter brukerinformasjon for å vise på dashbordet
  db.get('SELECT id, email, created_at FROM users WHERE id = ?', [req.session.userId], (err, user) => {
    // Håndterer databasefeil
    if (err) {
      console.error('DB-feil ved henting av bruker:', err);
      return res.redirect('/login?error=En+feil+oppstod.+Logg+inn+igjen');
    }
    // Hvis bruker ikke finnes (uvanlig, men håndteres)
    if (!user) {
      // Nullstill sesjonen og be om ny innlogging
      req.session.destroy(() => {
        return res.redirect('/login?error=Sesjonen+er+utl%C3%B8pt.+Logg+inn+igjen');
      });
      return;
    }
    // Renderer dashboard-siden med brukerinformasjon
    return res.render('dashboard', { user });
  });
});

// Rute: Logout (POST for å unngå CSRF via GET)
app.post('/logout', ensureAuthenticated, (req, res) => {
  // Ødelegger sesjonen for å logge ut
  req.session.destroy((err) => {
    // Logger feil om noe går galt under ødeleggelse av sesjon
    if (err) {
      console.error('Feil ved logout:', err);
    }
    // Fjerner cookie ved å sette den til tom
    res.clearCookie('connect.sid');
    // Sender bruker til login med melding
    return res.redirect('/login?success=Du+er+logget+ut');
  });
});

// Starter serveren og lytter på valgt port
app.listen(PORT, () => {
  // Logger til konsollen at serveren kjører
  console.log(`Server kjører på http://localhost:${PORT}`);
});