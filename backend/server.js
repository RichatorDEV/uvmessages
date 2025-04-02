const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const fs = require('fs').promises;

const app = express();

app.use(express.json());
app.use(cors());
app.use('/uploads', express.static('uploads'));

// Configurar Multer
const uploadDir = 'uploads';
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        try {
            await fs.mkdir(uploadDir, { recursive: true });
            cb(null, uploadDir);
        } catch (err) {
            console.error('Error al crear el directorio uploads:', err);
            cb(err);
        }
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }
});

// Conectar a PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Inicializar base de datos
async function initializeDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                displayName TEXT NOT NULL,
                profilePicture TEXT
            );
        `);
        console.log('Tabla "users" verificada o creada.');

        await pool.query(`DROP TABLE IF EXISTS messages CASCADE;`);
        await pool.query(`
            CREATE TABLE messages (
                id SERIAL PRIMARY KEY,
                senderId TEXT NOT NULL,
                recipientId TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT NOW(),
                isRead BOOLEAN DEFAULT FALSE,
                FOREIGN KEY (senderId) REFERENCES users(id),
                FOREIGN KEY (recipientId) REFERENCES users(id)
            );
        `);
        console.log('Tabla "messages" recreada.');

        await pool.query(`DROP TABLE IF EXISTS contacts CASCADE;`);
        await pool.query(`
            CREATE TABLE contacts (
                userId TEXT NOT NULL,
                contactId TEXT NOT NULL,
                PRIMARY KEY (userId, contactId),
                FOREIGN KEY (userId) REFERENCES users(id),
                FOREIGN KEY (contactId) REFERENCES users(id)
            );
        `);
        console.log('Tabla "contacts" recreada.');
    } catch (err) {
        console.error('Error al inicializar la base de datos:', err.stack);
        throw err;
    }
}

// Ruta de prueba
app.get('/api/test', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT NOW()');
        res.json({ message: '¡El servidor está funcionando!', dbTime: rows[0].now });
    } catch (err) {
        console.error('Error en /api/test:', err.stack);
        res.status(500).json({ error: 'Error en la base de datos', details: err.message });
    }
});

// Obtener todos los usuarios (para login)
app.get('/api/users', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT id, username, password, displayName, profilePicture FROM users');
        console.log('GET /api/users - Usuarios devueltos:', rows);
        res.json(rows);
    } catch (err) {
        console.error('Error al consultar usuarios:', err.stack);
        res.status(500).json({ error: 'Error en el servidor', details: err.message });
    }
});

// Crear un usuario
app.post('/api/users', async (req, res) => {
    try {
        const { username, password, displayName } = req.body;
        console.log('POST /api/users - Datos recibidos:', { username, password, displayName });
        if (!username || !password) {
            return res.status(400).json({ error: 'Faltan username o password' });
        }
        const finalDisplayName = displayName || username; // Usa username si displayName no se envía
        const query = `
            INSERT INTO users (id, username, password, displayName, profilePicture)
            VALUES ($1, $1, $2, $3, $4)
            ON CONFLICT (id) DO NOTHING
            RETURNING id, username, displayName, profilePicture;
        `;
        const values = [username, password, finalDisplayName, null];
        const { rows } = await pool.query(query, values);
        if (rows.length === 0) {
            return res.status(409).json({ error: 'El nombre de usuario ya está en uso' });
        }
        console.log('Usuario creado:', rows[0]);
        res.status(201).json({ message: 'Usuario creado', user: rows[0] });
    } catch (err) {
        console.error('Error al crear usuario:', err.stack);
        res.status(500).json({ error: 'Error en el servidor', details: err.message });
    }
});

// Obtener contactos de un usuario
app.get('/api/contacts', async (req, res) => {
    try {
        const { userId } = req.query;
        console.log('GET /api/contacts - userId:', userId);
        if (!userId) {
            return res.status(400).json({ error: 'Falta el userId' });
        }
        const query = `
            SELECT u.id, u.username, u.displayName, u.profilePicture,
                   (SELECT COUNT(*) 
                    FROM messages m 
                    WHERE m.recipientId = $1 AND m.senderId = u.id AND m.isRead = FALSE) AS unreadCount
            FROM contacts c
            JOIN users u ON c.contactId = u.id
            WHERE c.userId = $1;
        `;
        const { rows } = await pool.query(query, [userId]);
        console.log('Contactos devueltos para userId', userId, ':', rows);
        res.json(rows);
    } catch (err) {
        console.error('Error al obtener contactos:', err.stack);
        res.status(500).json({ error: 'Error en el servidor', details: err.message });
    }
});

// Agregar un contacto
app.post('/api/contacts', async (req, res) => {
    try {
        const { userId, contactId } = req.body;
        console.log('POST /api/contacts - Datos recibidos:', { userId, contactId });
        if (!userId || !contactId) {
            return res.status(400).json({ error: 'Faltan userId o contactId' });
        }
        if (userId === contactId) {
            return res.status(400).json({ error: 'No puedes agregarte a ti mismo' });
        }
        const checkUserQuery = 'SELECT id FROM users WHERE id = $1';
        const userExists = await pool.query(checkUserQuery, [contactId]);
        if (userExists.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        const query = `
            INSERT INTO contacts (userId, contactId)
            VALUES ($1, $2)
            ON CONFLICT (userId, contactId) DO NOTHING
            RETURNING *;
        `;
        const { rows } = await pool.query(query, [userId, contactId]);
        console.log('Contacto agregado:', rows[0]);
        res.status(201).json({ message: 'Contacto agregado', contact: rows[0] });
    } catch (err) {
        console.error('Error al agregar contacto:', err.stack);
        res.status(500).json({ error: 'Error en el servidor', details: err.message });
    }
});

// Actualizar perfil
app.post('/api/upload-profile-picture', upload.single('profilePicture'), async (req, res) => {
    try {
        const userId = req.body.userId;
        const displayName = req.body.displayName;
        const filePath = req.file ? `/uploads/${req.file.filename}` : null;

        console.log('POST /api/upload-profile-picture - Datos recibidos:', { 
            userId, 
            displayName, 
            filePath, 
            file: req.file ? { filename: req.file.filename, path: req.file.path } : null 
        });

        if (!userId) {
            return res.status(400).json({ error: 'Falta el userId' });
        }
        if (!displayName && !filePath) {
            return res.status(400).json({ error: 'Debe proporcionar displayName o una foto' });
        }

        let query = 'UPDATE users SET ';
        const values = [];
        let paramCount = 1;

        if (filePath) {
            query += `profilePicture = $${paramCount}`;
            values.push(filePath);
            paramCount++;
        }
        if (displayName) {
            if (filePath) query += ', ';
            query += `displayName = $${paramCount}`;
            values.push(displayName);
            paramCount++;
        }
        query += ` WHERE id = $${paramCount} RETURNING id, username, displayName, profilePicture`;
        values.push(userId);

        const { rows } = await pool.query(query, values);
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        console.log('Usuario actualizado:', rows[0]);
        res.json({ message: 'Perfil actualizado', user: rows[0] });
    } catch (err) {
        console.error('Error al actualizar perfil:', err.stack);
        res.status(500).json({ error: 'Error en el servidor', details: err.message });
    }
});

// Enviar un mensaje
app.post('/api/messages', async (req, res) => {
    try {
        const { senderId, recipientId, content } = req.body;
        console.log('POST /api/messages - Datos recibidos:', { senderId, recipientId, content });
        if (!senderId || !recipientId || !content) {
            return res.status(400).json({ error: 'Faltan senderId, recipientId o content' });
        }
        const query = `
            INSERT INTO messages (senderId, recipientId, content, timestamp, isRead)
            VALUES ($1, $2, $3, NOW(), FALSE)
            RETURNING *;
        `;
        const values = [senderId, recipientId, content];
        const { rows } = await pool.query(query, values);
        console.log('Mensaje enviado:', rows[0]);
        res.status(201).json({ message: 'Mensaje enviado', message: rows[0] });
    } catch (err) {
        console.error('Error al enviar mensaje:', err.stack);
        res.status(500).json({ error: 'Error en el servidor', details: err.message });
    }
});

// Obtener mensajes entre dos usuarios
app.get('/api/messages', async (req, res) => {
    try {
        const { userId, contactId } = req.query;
        console.log('GET /api/messages - Parámetros:', { userId, contactId });
        if (!userId || !contactId) {
            return res.status(400).json({ error: 'Faltan userId o contactId' });
        }
        const query = `
            SELECT m.*, 
                   u1.displayName AS senderDisplayName, 
                   u1.profilePicture AS senderPicture,
                   u2.displayName AS recipientDisplayName, 
                   u2.profilePicture AS recipientPicture
            FROM messages m
            JOIN users u1 ON m.senderId = u1.id
            JOIN users u2 ON m.recipientId = u2.id
            WHERE (m.senderId = $1 AND m.recipientId = $2) OR (m.senderId = $2 AND m.recipientId = $1)
            ORDER BY m.timestamp ASC;
        `;
        const values = [userId, contactId];
        const { rows } = await pool.query(query, values);
        console.log('Mensajes devueltos:', rows);
        res.json(rows);
    } catch (err) {
        console.error('Error al obtener mensajes:', err.stack);
        res.status(500).json({ error: 'Error en el servidor', details: err.message });
    }
});

// Marcar mensajes como leídos
app.post('/api/messages/read', async (req, res) => {
    try {
        const { userId, contactId } = req.body;
        console.log('POST /api/messages/read - Datos recibidos:', { userId, contactId });
        if (!userId || !contactId) {
            return res.status(400).json({ error: 'Faltan userId o contactId' });
        }
        const query = `
            UPDATE messages 
            SET isRead = TRUE 
            WHERE recipientId = $1 AND senderId = $2 AND isRead = FALSE
            RETURNING *;
        `;
        const values = [userId, contactId];
        const { rows } = await pool.query(query, values);
        console.log('Mensajes marcados como leídos:', rows);
        res.json({ message: 'Mensajes marcados como leídos', updated: rows });
    } catch (err) {
        console.error('Error al marcar mensajes como leídos:', err.stack);
        res.status(500).json({ error: 'Error en el servidor', details: err.message });
    }
});

// Iniciar servidor
const PORT = process.env.PORT || 5432;
app.listen(PORT, async () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
    try {
        await pool.query('SELECT 1');
        console.log('Conexión a la base de datos establecida.');
        await initializeDatabase();
        const { rows } = await pool.query('SELECT NOW()');
        console.log('Base de datos inicializada. Hora actual:', rows[0].now);
    } catch (err) {
        console.error('Error al iniciar el servidor:', err.stack);
        process.exit(1);
    }
});

process.on('uncaughtException', (err) => {
    console.error('Error no capturado:', err.stack);
    process.exit(1);
});
