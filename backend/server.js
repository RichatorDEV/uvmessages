const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const fs = require('fs').promises;

const app = express();

app.use(express.json());
app.use(cors());

// Configurar Multer para manejar subidas de archivos
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

// Función para inicializar la base de datos
async function initializeDatabase() {
    try {
        // Crear la tabla users si no existe
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
    } catch (err) {
        console.error('Error al crear la tabla users:', err);
    }

    // No necesitamos añadir profilePicture si ya existe, CREATE TABLE IF NOT EXISTS ya lo incluye
}

// Ruta de prueba
app.get('/api/test', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT NOW()');
        res.json({ 
            message: '¡El servidor está funcionando!', 
            dbTime: rows[0].now 
        });
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

// Manejar errores no capturados
process.on('uncaughtException', (err) => {
    console.error('Error no capturado:', err);
});
