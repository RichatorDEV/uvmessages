const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
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

// Registro de usuario
app.post('/api/users', async (req, res) => {
    const { username, password } = req.body;
    console.log('POST /api/users - Registrando usuario:', { username, password });

    try {
        const lastIdResult = await pool.query('SELECT MAX(id) FROM users');
        const lastId = lastIdResult.rows[0].max || 0;
        const newId = lastId + 1;

        console.log('Generando nuevo id para users:', newId);

        const result = await pool.query(
            'INSERT INTO users (id, username, password) VALUES ($1, $2, $3) RETURNING id, username',
            [newId, username, password]
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
        const result = await pool.query('SELECT id, username, password, profilePicture FROM users');
        console.log('Usuarios enviados:', result.rows);
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener usuarios:', error);
        res.status(500).json({ error: 'Error al obtener usuarios', details: error.message });
    }
});

// Subir foto de perfil
app.post('/api/upload-profile-picture', upload.single('profilePicture'), async (req, res) => {
    const { userId } = req.body;
    const profilePicture = req.file ? `/uploads/${req.file.filename}` : null;

    console.log('POST /api/upload-profile-picture - Datos recibidos:', { userId, profilePicture, file: req.file });

    if (!userId) {
        return res.status(400).json({ error: 'Falta userId' });
    }

    try {
        const result = await pool.query(
            'UPDATE users SET profilePicture = $1 WHERE id = $2 RETURNING id, username, profilePicture',
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
app.post('/api/contacts', async (req, res) => {
    const { userId, contactId } = req.body;
    console.log('Agregando contacto:', { userId, contactId });

    try {
        const contactExists = await pool.query('SELECT id FROM users WHERE username = $1', [contactId]);
        if (contactExists.rows.length === 0) {
            return res.status(404).json({ error: 'Contacto no encontrado' });
        }

        const contactIdNum = contactExists.rows[0].id;
        const lastIdResult = await pool.query('SELECT MAX(id) FROM contacts');
        const lastId = lastIdResult.rows[0].max || 0;
        const newId = lastId + 1;

        console.log('Generando nuevo id para contacts:', newId);

        const result = await pool.query(
            'INSERT INTO contacts (id, user_id, contact_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING *',
            [newId, userId, contactIdNum]
        );
        res.json({ contact: result.rows[0] });
    } catch (error) {
        console.error('Error al agregar contacto:', error);
        res.status(500).json({ error: 'Error al agregar contacto', details: error.message });
    }
});

// Obtener contactos
app.get('/api/contacts', async (req, res) => {
    const { userId } = req.query;
    console.log('Obteniendo contactos para userId:', userId);

    try {
        const result = await pool.query(`
            SELECT u.id, u.username, u.profilePicture, 
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
app.post('/api/messages', async (req, res) => {
    const { senderId, recipientId, content } = req.body;
    console.log('POST /api/messages - Enviando mensaje:', { senderId, recipientId, content });

    if (!senderId || !recipientId || !content) {
        return res.status(400).json({ error: 'Faltan datos requeridos' });
    }

    try {
        const lastIdResult = await pool.query('SELECT MAX(id) FROM messages');
        const lastId = lastIdResult.rows[0].max || 0;
        const newId = lastId + 1;

        console.log('Generando nuevo id para messages:', newId);

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
app.get('/api/messages', async (req, res) => {
    const { userId, contactId } = req.query;
    console.log('GET /api/messages - Obteniendo mensajes entre:', { userId, contactId });

    if (!userId || !contactId) {
        return res.status(400).json({ error: 'Faltan userId o contactId' });
    }

    try {
        const result = await pool.query(`
            SELECT m.id, m.sender_id, m.recipient_id, m.content, m.timestamp, m.read,
                   u.username AS sender_username, u.profilePicture AS sender_picture
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
app.post('/api/messages/read', async (req, res) => {
    const { userId, contactId } = req.body;
    console.log('Marcando mensajes como leídos:', { userId, contactId });

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

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});
