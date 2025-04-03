const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const multer = require('multer');

const app = express();

// Configuración de CORS
app.use(cors({
    origin: ['https://tu-usuario.github.io', 'http://localhost:3000'], // Reemplaza "tu-usuario" con tu nombre de usuario de GitHub
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuración de Multer para subir imágenes
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads');
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});
const upload = multer({ storage });

// Conexión a PostgreSQL con las credenciales de Railway
const pool = new Pool({
    user: 'postgres',
    host: 'postgres.railway.internal',
    database: 'railway',
    password: 'bvWbxlacTurABfHGKFmaLDxuUstLdKia',
    port: 5432
});

// Ruta para servir archivos estáticos (imágenes)
app.get('/uploads/:filename', (req, res) => {
    const filePath = path.join(__dirname, 'public/uploads', req.params.filename);
    console.log('Solicitando archivo:', filePath);
    res.sendFile(filePath, (err) => {
        if (err) {
            console.error('Error al servir archivo:', err);
            res.status(404).send('Archivo no encontrado');
        }
    });
});

// Registro de usuario
app.post('/api/users', async (req, res) => {
    const { username, password } = req.body;
    console.log('Registrando usuario:', { username, password });

    try {
        const result = await pool.query(
            'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id, username',
            [username, password]
        );
        res.json({ user: result.rows[0] });
    } catch (error) {
        console.error('Error al registrar usuario:', error);
        res.status(500).json({ error: 'Error al registrar usuario' });
    }
});

// Obtener todos los usuarios
app.get('/api/users', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, profilePicture FROM users');
        console.log('Usuarios enviados:', result.rows);
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener usuarios:', error);
        res.status(500).json({ error: 'Error al obtener usuarios' });
    }
});

// Subir foto de perfil
app.post('/api/upload-profile-picture', upload.single('profilePicture'), async (req, res) => {
    const { userId } = req.body;
    const profilePicture = req.file ? `/uploads/${req.file.filename}` : null;

    console.log('Subiendo foto para userId:', userId, 'ProfilePicture:', profilePicture);

    try {
        const result = await pool.query(
            'UPDATE users SET profilePicture = $1 WHERE id = $2 RETURNING id, username, profilePicture',
            [profilePicture, userId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        res.json({ user: result.rows[0] });
    } catch (error) {
        console.error('Error al actualizar foto de perfil:', error);
        res.status(500).json({ error: 'Error al actualizar foto de perfil' });
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
        const result = await pool.query(
            'INSERT INTO contacts (user_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *',
            [userId, contactIdNum]
        );
        res.json({ contact: result.rows[0] });
    } catch (error) {
        console.error('Error al agregar contacto:', error);
        res.status(500).json({ error: 'Error al agregar contacto' });
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
        res.status(500).json({ error: 'Error al obtener contactos' });
    }
});

// Enviar mensaje
app.post('/api/messages', async (req, res) => {
    const { senderId, recipientId, content } = req.body;
    console.log('Enviando mensaje:', { senderId, recipientId, content });

    try {
        const result = await pool.query(
            'INSERT INTO messages (sender_id, recipient_id, content) VALUES ($1, $2, $3) RETURNING *',
            [senderId, recipientId, content]
        );
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error al enviar mensaje:', error);
        res.status(500).json({ error: 'Error al enviar mensaje' });
    }
});

// Obtener mensajes (incluyendo username del remitente)
app.get('/api/messages', async (req, res) => {
    const { userId, contactId } = req.query;
    console.log('Obteniendo mensajes entre:', { userId, contactId });

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
        res.status(500).json({ error: 'Error al obtener mensajes' });
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
        res.status(500).json({ error: 'Error al marcar mensajes como leídos' });
    }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});
