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
                displayName TEXT,
                profilePicture TEXT
            );
        `);
        console.log('Tabla "users" verificada o creada exitosamente.');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                senderId TEXT NOT NULL,
                recipientId TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT NOW(),
                FOREIGN KEY (senderId) REFERENCES users(id),
                FOREIGN KEY (recipientId) REFERENCES users(id)
            );
        `);
        console.log('Tabla "messages" verificada o creada exitosamente.');
    } catch (err) {
        console.error('Error al inicializar la base de datos:', err);
    }
}

// Ruta de prueba
app.get('/api/test', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT NOW()');
        res.json({ message: '¡El servidor está funcionando!', dbTime: rows[0].now });
    } catch (err) {
        console.error('Error al conectar a la base de datos:', err);
        res.status(500).json({ message: 'Error en la base de datos', error: err.message });
    }
});

// Obtener usuarios
app.get('/api/users', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM users');
        res.json(rows);
    } catch (err) {
        console.error('Error al consultar usuarios:', err);
        res.status(500).json({ error: 'Error en el servidor' });
    }
});

// Crear un usuario
app.post('/api/users', async (req, res) => {
    try {
        const { id, username, password, displayName, profilePicture } = req.body;
        if (!id || !username || !password) {
            return res.status(400).json({ error: 'Faltan campos requeridos: id, username, password' });
        }
        const query = `
            INSERT INTO users (id, username, password, displayName, profilePicture)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *;
        `;
        const values = [id, username, password, displayName || null, profilePicture || null];
        const { rows } = await pool.query(query, values);
        res.status(201).json({ message: 'Usuario creado exitosamente', user: rows[0] });
    } catch (err) {
        console.error('Error al crear usuario:', err);
        res.status(500).json({ error: 'Error en el servidor al crear usuario', details: err.message });
    }
});

// Subir foto de perfil
app.post('/api/upload-profile-picture', upload.single('profilePicture'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se subió ningún archivo' });
        }
        const filePath = req.file.path;
        const userId = req.body.userId;
        const query = 'UPDATE users SET profilePicture = $1 WHERE id = $2 RETURNING *';
        const { rows } = await pool.query(query, [filePath, userId]);
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        res.json({ message: 'Archivo subido exitosamente', user: rows[0] });
    } catch (err) {
        console.error('Error al subir archivo:', err);
        res.status(500).json({ error: 'Error en el servidor', details: err.message });
    }
});

// Enviar un mensaje
app.post('/api/messages', async (req, res) => {
    try {
        const { senderId, recipientId, content } = req.body;
        if (!senderId || !recipientId || !content) {
            return res.status(400).json({ error: 'Faltan campos requeridos: senderId, recipientId, content' });
        }
        const query = `
            INSERT INTO messages (senderId, recipientId, content, timestamp)
            VALUES ($1, $2, $3, NOW())
            RETURNING *;
        `;
        const values = [senderId, recipientId, content];
        const { rows } = await pool.query(query, values);
        res.status(201).json({ message: 'Mensaje enviado exitosamente', message: rows[0] });
    } catch (err) {
        console.error('Error al enviar mensaje:', err);
        res.status(500).json({ error: 'Error en el servidor al enviar mensaje', details: err.message });
    }
});

// Obtener mensajes entre dos usuarios
app.get('/api/messages', async (req, res) => {
    try {
        const { userId, contactId } = req.query;
        if (!userId || !contactId) {
            return res.status(400).json({ error: 'Faltan parámetros: userId, contactId' });
        }
        const query = `
            SELECT m.*, u1.displayName AS senderName, u1.profilePicture AS senderPicture,
                   u2.displayName AS recipientName, u2.profilePicture AS recipientPicture
            FROM messages m
            JOIN users u1 ON m.senderId = u1.id
            JOIN users u2 ON m.recipientId = u2.id
            WHERE (m.senderId = $1 AND m.recipientId = $2) OR (m.senderId = $2 AND m.recipientId = $1)
            ORDER BY m.timestamp ASC;
        `;
        const values = [userId, contactId];
        const { rows } = await pool.query(query, values);
        res.json(rows);
    } catch (err) {
        console.error('Error al obtener mensajes:', err);
        res.status(500).json({ error: 'Error en el servidor al obtener mensajes', details: err.message });
    }
});

// Iniciar servidor
const PORT = process.env.PORT || 5432;
app.listen(PORT, async () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
    await initializeDatabase();
    try {
        const { rows } = await pool.query('SELECT NOW()');
        console.log('Conexión a la base de datos exitosa. Hora actual:', rows[0].now);
    } catch (err) {
        console.error('Error al conectar a la base de datos al iniciar:', err);
    }
});

process.on('uncaughtException', (err) => {
    console.error('Error no capturado:', err);
});
