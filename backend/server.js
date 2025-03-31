const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static('public'));

// Configurar multer para subir fotos
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads/'),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

// Conectar a la base de datos
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) console.error('Error al conectar a la base de datos:', err);
    else console.log('Conectado a la base de datos SQLite');
});

// Crear tablas y manejar migración
db.serialize(() => {
    // Verificar si la tabla users existe
    db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='users'", (err, rows) => {
        if (err) {
            console.error('Error al verificar existencia de tabla:', err);
            return;
        }

        if (rows.length === 0) {
            // Si no existe, crear la tabla directamente con todas las columnas
            console.log('Creando tabla users desde cero...');
            db.run(`
                CREATE TABLE users (
                    id TEXT PRIMARY KEY,
                    username TEXT UNIQUE,
                    password TEXT,
                    displayName TEXT,
                    profilePicture TEXT
                )
            `, (err) => {
                if (err) console.error('Error al crear tabla users:', err);
                else console.log('Tabla users creada');
            });
        } else {
            // Si existe, verificar si tiene las columnas necesarias
            db.all("PRAGMA table_info(users)", (err, columns) => {
                if (err) {
                    console.error('Error al verificar columnas:', err);
                    return;
                }
                const hasDisplayName = columns.some(col => col.name === 'displayName');
                const hasProfilePicture = columns.some(col => col.name === 'profilePicture');

                if (!hasDisplayName || !hasProfilePicture) {
                    console.log('Migrando tabla users...');
                    // Renombrar la tabla antigua
                    db.run('ALTER TABLE users RENAME TO users_old', (err) => {
                        if (err) console.error('Error al renombrar tabla:', err);
                    });
                    // Crear la nueva tabla
                    db.run(`
                        CREATE TABLE users (
                            id TEXT PRIMARY KEY,
                            username TEXT UNIQUE,
                            password TEXT,
                            displayName TEXT,
                            profilePicture TEXT
                        )
                    `, (err) => {
                        if (err) console.error('Error al crear nueva tabla:', err);
                    });
                    // Migrar datos
                    db.run(`
                        INSERT INTO users (id, username, password)
                        SELECT id, username, password FROM users_old
                    `, (err) => {
                        if (err) console.error('Error al migrar datos:', err);
                    });
                    // Actualizar displayName con username por defecto
                    db.run('UPDATE users SET displayName = username WHERE displayName IS NULL', (err) => {
                        if (err) console.error('Error al actualizar displayName:', err);
                    });
                    // Eliminar la tabla antigua
                    db.run('DROP TABLE users_old', (err) => {
                        if (err) console.error('Error al eliminar tabla antigua:', err);
                        else console.log('Migración completada');
                    });
                } else {
                    console.log('Tabla users ya tiene las columnas necesarias');
                }
            });
        }
    });

    // Crear otras tablas si no existen
    db.run(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            senderId TEXT,
            recipientId TEXT,
            content TEXT,
            timestamp TEXT,
            FOREIGN KEY (senderId) REFERENCES users(id),
            FOREIGN KEY (recipientId) REFERENCES users(id)
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS contacts (
            userId TEXT,
            contactId TEXT,
            FOREIGN KEY (userId) REFERENCES users(id),
            FOREIGN KEY (contactId) REFERENCES users(id),
            PRIMARY KEY (userId, contactId)
        )
    `);
});

// Registro de usuario
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    console.log('POST /api/register:', req.body);
    if (!username || !password) {
        return res.status(400).json({ message: 'Faltan username o password' });
    }
    const stmt = db.prepare('INSERT INTO users (id, username, password, displayName) VALUES (?, ?, ?, ?)');
    stmt.run(username, username, password, username, (err) => {
        if (err) {
            console.error('Error al registrar:', err);
            return res.status(400).json({ message: 'El usuario ya existe' });
        }
        res.json({ message: 'Registro exitoso', userId: username });
    });
    stmt.finalize();
});

// Inicio de sesión
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    console.log('POST /api/login:', req.body);
    if (!username || !password) {
        return res.status(400).json({ message: 'Faltan username o password' });
    }
    db.get('SELECT * FROM users WHERE username = ? AND password = ?', [username, password], (err, row) => {
        if (err) {
            console.error('Error al buscar usuario:', err);
            return res.status(500).json({ message: 'Error en el servidor' });
        }
        if (!row) return res.status(401).json({ message: 'Credenciales inválidas' });
        res.json({ 
            message: 'Inicio de sesión exitoso', 
            userId: row.id, 
            username: row.username, 
            displayName: row.displayName, 
            profilePicture: row.profilePicture 
        });
    });
});

// Actualizar perfil
app.post('/api/profile', upload.single('profilePicture'), (req, res) => {
    console.log('POST /api/profile:', req.body, req.file);
    const { userId, displayName } = req.body;
    if (!userId) return res.status(400).json({ message: 'Falta userId' });

    const updates = [];
    const params = [];
    if (displayName) {
        updates.push('displayName = ?');
        params.push(displayName);
    }
    if (req.file) {
        updates.push('profilePicture = ?');
        params.push(`/uploads/${req.file.filename}`);
    }
    if (updates.length === 0) return res.status(400).json({ message: 'No hay datos para actualizar' });

    params.push(userId);
    const query = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
    console.log('Ejecutando consulta:', query, params);
    db.run(query, params, (err) => {
        if (err) {
            console.error('Error al actualizar perfil:', err);
            return res.status(500).json({ message: 'Error al actualizar perfil', error: err.message });
        }
        res.json({ message: 'Perfil actualizado' });
    });
});

// Agregar contacto
app.post('/api/contacts', (req, res) => {
    const { userId, contactId } = req.body;
    console.log('POST /api/contacts:', req.body);
    if (!userId || !contactId) return res.status(400).json({ message: 'Faltan userId o contactId' });
    db.get('SELECT * FROM users WHERE id = ?', [contactId], (err, row) => {
        if (err) {
            console.error('Error al buscar contacto:', err);
            return res.status(500).json({ message: 'Error en el servidor' });
        }
        if (!row) return res.status(404).json({ message: 'Contacto no encontrado' });
        const stmt = db.prepare('INSERT OR IGNORE INTO contacts (userId, contactId) VALUES (?, ?)');
        stmt.run(userId, contactId, (err) => {
            if (err) {
                console.error('Error al agregar contacto:', err);
                return res.status(500).json({ message: 'Error al agregar contacto', error: err.message });
            }
            console.log('Contacto agregado:', { userId, contactId });
            res.json({ message: 'Contacto agregado' });
        });
        stmt.finalize();
    });
});

// Obtener contactos con detalles
app.get('/api/contacts/:userId', (req, res) => {
    const userId = req.params.userId;
    console.log('GET /api/contacts:', userId);
    db.all(
        'SELECT u.id, u.displayName, u.profilePicture FROM contacts c JOIN users u ON c.contactId = u.id WHERE c.userId = ?',
        [userId],
        (err, rows) => {
            if (err) {
                console.error('Error al obtener contactos:', err);
                return res.status(500).json({ message: 'Error al obtener contactos', error: err.message });
            }
            console.log('Contactos encontrados:', rows);
            res.json(rows);
        }
    );
});

// Enviar mensaje
app.post('/api/messages', (req, res) => {
    const { senderId, recipientId, content } = req.body;
    console.log('POST /api/messages:', req.body);
    if (!senderId || !recipientId || !content) return res.status(400).json({ message: 'Faltan datos en el mensaje' });
    db.get('SELECT * FROM users WHERE id = ?', [recipientId], (err, row) => {
        if (err || !row) return res.status(404).json({ message: 'Destinatario no encontrado' });
        const stmt = db.prepare('INSERT INTO messages (senderId, recipientId, content, timestamp) VALUES (?, ?, ?, ?)');
        const timestamp = new Date().toISOString();
        stmt.run(senderId, recipientId, content, timestamp, (err) => {
            if (err) return res.status(500).json({ message: 'Error al enviar mensaje' });
            res.json({ message: 'Mensaje enviado' });
        });
        stmt.finalize();
    });
});

// Obtener mensajes entre dos usuarios
app.get('/api/messages/:userId/:contactId', (req, res) => {
    const { userId, contactId } = req.params;
    console.log('GET /api/messages:', { userId, contactId });
    db.all(
        'SELECT m.*, u.displayName, u.profilePicture FROM messages m JOIN users u ON m.senderId = u.id WHERE (m.senderId = ? AND m.recipientId = ?) OR (m.senderId = ? AND m.recipientId = ?) ORDER BY m.timestamp',
        [userId, contactId, contactId, userId],
        (err, rows) => {
            if (err) return res.status(500).json({ message: 'Error en el servidor' });
            res.json(rows);
        }
    );
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

process.on('SIGINT', () => {
    db.close((err) => {
        if (err) console.error('Error al cerrar la base de datos:', err);
        console.log('Base de datos cerrada');
        process.exit(0);
    });
});