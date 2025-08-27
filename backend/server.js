const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type']
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Crear directorio uploads si no existe
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads');
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});
const upload = multer({ storage });

const pool = new Pool({
    user: 'postgres',
    host: 'postgres.railway.internal',
    database: 'railway',
    password: 'bvWbxlacTurABfHGKFmaLDxuUstLdKia',
    port: 5432
});

// Middleware para verificar si el usuario está baneado
async function checkBanned(req, res, next) {
    const { userId } = req.body || req.query;
    if (!userId) {
        return res.status(400).json({ error: 'Falta userId' });
    }
    try {
        const result = await pool.query('SELECT is_banned, ban_expiration FROM users WHERE id = $1', [userId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        const user = result.rows[0];
        if (user.is_banned) {
            if (!user.ban_expiration || new Date(user.ban_expiration) > new Date()) {
                return res.status(403).json({ error: 'Estás baneado. Contacta a un administrador.' });
            } else {
                // Si el baneo ha expirado, actualizar el estado
                await pool.query('UPDATE users SET is_banned = FALSE, ban_expiration = NULL WHERE id = $1', [userId]);
            }
        }
        next();
    } catch (error) {
        console.error('Error en checkBanned:', error);
        res.status(500).json({ error: 'Error al verificar estado de baneo', details: error.message });
    }
}

// Crear/modificar tablas
app.post('/api/create-tables', async (req, res) => {
    console.log('POST /api/create-tables - Creando/modificando tablas');
    try {
        // Crear tabla users si no existe
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                profilePicture VARCHAR(255),
                role VARCHAR(20) DEFAULT 'user',
                is_banned BOOLEAN DEFAULT FALSE,
                ban_expiration TIMESTAMP
            )
        `);
        // Agregar columnas si no existen
        await pool.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user',
            ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS ban_expiration TIMESTAMP
        `);
        res.json({ success: true, message: 'Tablas creadas/modificadas correctamente' });
    } catch (error) {
        console.error('Error al crear/modificar tablas:', error);
        res.status(500).json({ error: 'Error al crear/modificar tablas', details: error.message });
    }
});

// Registro de usuario
app.post('/api/users', async (req, res) => {
    const { username, password } = req.body;
    console.log('POST /api/users - Registrando usuario:', { username });
    if (!username || !password) {
        return res.status(400).json({ error: 'Faltan username o password' });
    }
    try {
        const lastIdResult = await pool.query('SELECT MAX(id) FROM users');
        const lastId = lastIdResult.rows[0].max || 0;
        const newId = lastId + 1;

        const result = await pool.query(
            'INSERT INTO users (id, username, password, role, is_banned, ban_expiration) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, username, role',
            [newId, username, password, 'user', false, null]
        );
        console.log('Usuario registrado con éxito:', result.rows[0]);
        res.json({ user: result.rows[0] });
    } catch (error) {
        console.error('Error al registrar usuario:', error);
        res.status(500).json({ error: 'Error al registrar usuario', details: error.message });
    }
});

// Obtener todos los usuarios
app.get('/api/users', async (req, res) => {
    console.log('GET /api/users - Solicitando lista de usuarios');
    try {
        const result = await pool.query('SELECT id, username, profilePicture, role FROM users');
        console.log('Usuarios enviados:', result.rows);
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener usuarios:', error);
        res.status(500).json({ error: 'Error al obtener usuarios', details: error.message });
    }
});

// Subir foto de perfil
app.post('/api/upload-profile-picture', upload.single('profilePicture'), checkBanned, async (req, res) => {
    const { userId } = req.body;
    const profilePicture = req.file ? `/uploads/${req.file.filename}` : null;

    console.log('POST /api/upload-profile-picture - Datos recibidos:', { userId, profilePicture });

    if (!userId || !profilePicture) {
        return res.status(400).json({ error: 'Falta userId o profilePicture' });
    }

    try {
        const result = await pool.query(
            'UPDATE users SET profilePicture = $1 WHERE id = $2 RETURNING id, username, profilePicture, role',
            [profilePicture, userId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        console.log('Foto de perfil actualizada:', result.rows[0]);
        res.json({ user: result.rows[0] });
    } catch (error) {
        console.error('Error al actualizar foto de perfil:', error);
        res.status(500).json({ error: 'Error al actualizar foto de perfil', details: error.message });
    }
});

// Agregar contacto
app.post('/api/contacts', checkBanned, async (req, res) => {
    const { userId, contactId } = req.body;
    console.log('POST /api/contacts - Agregando contacto:', { userId, contactId });

    try {
        const contactExists = await pool.query('SELECT id, role FROM users WHERE username = $1', [contactId]);
        if (contactExists.rows.length === 0) {
            return res.status(404).json({ error: 'Contacto no encontrado' });
        }

        const contactIdNum = contactExists.rows[0].id;
        const lastIdResult = await pool.query('SELECT MAX(id) FROM contacts');
        const lastId = lastIdResult.rows[0].max || 0;
        const newId = lastId + 1;

        const result = await pool.query(
            'INSERT INTO contacts (id, user_id, contact_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING *',
            [newId, userId, contactIdNum]
        );
        res.json({ contact: { ...result.rows[0], role: contactExists.rows[0].role } });
    } catch (error) {
        console.error('Error al agregar contacto:', error);
        res.status(500).json({ error: 'Error al agregar contacto', details: error.message });
    }
});

// Obtener contactos
app.get('/api/contacts', checkBanned, async (req, res) => {
    const { userId } = req.query;
    console.log('GET /api/contacts - Obteniendo contactos para userId:', userId);

    try {
        const result = await pool.query(`
            SELECT u.id, u.username, u.profilePicture, u.role,
                   (SELECT COUNT(*) FROM messages m 
                    WHERE m.recipient_id = $1 AND m.sender_id = u.id AND m.read = false) AS unreadCount
            FROM contacts c
            JOIN users u ON c.contact_id = u.id
            WHERE c.user_id = $1
        `, [userId]);
        console.log('Contactos enviados:', result.rows);
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener contactos:', error);
        res.status(500).json({ error: 'Error al obtener contactos', details: error.message });
    }
});

// Enviar mensaje
app.post('/api/messages', checkBanned, async (req, res) => {
    const { senderId, recipientId, content } = req.body;
    console.log('POST /api/messages - Enviando mensaje:', { senderId, recipientId, content });

    if (!senderId || !recipientId || !content) {
        return res.status(400).json({ error: 'Faltan datos requeridos' });
    }

    try {
        // Verificar si el destinatario está baneado
        const recipient = await pool.query('SELECT is_banned, ban_expiration FROM users WHERE id = $1', [recipientId]);
        if (recipient.rows.length === 0) {
            return res.status(404).json({ error: 'Destinatario no encontrado' });
        }
        if (recipient.rows[0].is_banned) {
            if (!recipient.rows[0].ban_expiration || new Date(recipient.rows[0].ban_expiration) > new Date()) {
                return res.status(403).json({ error: 'El destinatario está baneado' });
            } else {
                await pool.query('UPDATE users SET is_banned = FALSE, ban_expiration = NULL WHERE id = $1', [recipientId]);
            }
        }

        const lastIdResult = await pool.query('SELECT MAX(id) FROM messages');
        const lastId = lastIdResult.rows[0].max || 0;
        const newId = lastId + 1;

        const result = await pool.query(
            'INSERT INTO messages (id, sender_id, recipient_id, content) VALUES ($1, $2, $3, $4) RETURNING *',
            [newId, senderId, recipientId, content]
        );
        console.log('Mensaje enviado con éxito:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error al enviar mensaje:', error);
        res.status(500).json({ error: 'Error al enviar mensaje', details: error.message });
    }
});

// Obtener mensajes
app.get('/api/messages', checkBanned, async (req, res) => {
    const { userId, contactId } = req.query;
    console.log('GET /api/messages - Obteniendo mensajes entre:', { userId, contactId });

    if (!userId || !contactId) {
        return res.status(400).json({ error: 'Faltan userId o contactId' });
    }

    try {
        const result = await pool.query(`
            SELECT m.id, m.sender_id, m.recipient_id, m.content, m.timestamp, m.read,
                   u.username AS sender_username, u.profilePicture AS sender_picture, u.role
            FROM messages m
            LEFT JOIN users u ON m.sender_id = u.id
            WHERE (m.sender_id = $1 AND m.recipient_id = $2) OR (m.sender_id = $2 AND m.recipient_id = $1)
            ORDER BY m.timestamp ASC
        `, [userId, contactId]);
        console.log('Mensajes enviados:', result.rows);
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener mensajes:', error);
        res.status(500).json({ error: 'Error al obtener mensajes', details: error.message });
    }
});

// Marcar mensajes como leídos
app.post('/api/messages/read', checkBanned, async (req, res) => {
    const { userId, contactId } = req.body;
    console.log('POST /api/messages/read - Marcando mensajes como leídos:', { userId, contactId });

    try {
        const result = await pool.query(
            'UPDATE messages SET read = true WHERE recipient_id = $1 AND sender_id = $2 AND read = false RETURNING *',
            [userId, contactId]
        );
        res.json({ updated: result.rowCount });
    } catch (error) {
        console.error('Error al marcar mensajes como leídos:', error);
        res.status(500).json({ error: 'Error al marcar mensajes como leídos', details: error.message });
    }
});

// Banear usuario
app.post('/api/ban-user', checkBanned, async (req, res) => {
    const { adminId, targetUsername, duration } = req.body;
    console.log('POST /api/ban-user - Intentando banear:', { adminId, targetUsername, duration });

    if (!adminId || !targetUsername) {
        return res.status(400).json({ error: 'Faltan adminId o targetUsername' });
    }

    try {
        // Verificar si el usuario es admin
        const adminResult = await pool.query('SELECT role FROM users WHERE id = $1', [adminId]);
        if (adminResult.rows.length === 0 || adminResult.rows[0].role !== 'admin') {
            return res.status(403).json({ error: 'No tienes permiso para banear usuarios' });
        }

        // Verificar si el usuario objetivo existe
        const targetResult = await pool.query('SELECT id FROM users WHERE username = $1', [targetUsername]);
        if (targetResult.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario objetivo no encontrado' });
        }

        const targetId = targetResult.rows[0].id;
        const banExpiration = duration ? new Date(Date.now() + duration * 60 * 1000) : null;

        await pool.query(
            'UPDATE users SET is_banned = TRUE, ban_expiration = $1 WHERE id = $2',
            [banExpiration, targetId]
        );
        console.log('Usuario baneado con éxito:', { targetUsername, duration });
        res.json({ success: true, message: `Usuario ${targetUsername} baneado` });
    } catch (error) {
        console.error('Error al banear usuario:', error);
        res.status(500).json({ error: 'Error al banear usuario', details: error.message });
    }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
    // Crear/modificar tablas al iniciar el servidor
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                profilePicture VARCHAR(255),
                role VARCHAR(20) DEFAULT 'user',
                is_banned BOOLEAN DEFAULT FALSE,
                ban_expiration TIMESTAMP
            )
        `);
        await pool.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user',
            ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS ban_expiration TIMESTAMP
        `);
        console.log('Tablas verificadas/creadas al iniciar el servidor');
    } catch (error) {
        console.error('Error al verificar/crear tablas al iniciar:', error);
    }
});
