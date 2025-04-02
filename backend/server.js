// ... (inicio del código igual)

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
        console.log('Tabla "messages" recreada exitosamente con TIMESTAMP.');

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
        console.log('Tabla "contacts" recreada exitosamente.');
    } catch (err) {
        console.error('Error al inicializar la base de datos:', err);
    }
}

// ... (rutas previas como /api/test, /api/users igual)

// Obtener contactos de un usuario
app.get('/api/contacts', async (req, res) => {
    try {
        const { userId } = req.query;
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
        console.log('Contactos devueltos:', rows); // Depuración
        res.json(rows);
    } catch (err) {
        console.error('Error al obtener contactos:', err);
        res.status(500).json({ error: 'Error en el servidor', details: err.message });
    }
});

// ... (resto del código igual: /api/contacts POST, /api/upload-profile-picture, etc.)

// Iniciar servidor
const PORT = process.env.PORT || 5432;
app.listen(PORT, async () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
    try {
        await initializeDatabase();
        const { rows } = await pool.query('SELECT NOW()');
        console.log('Conexión a la base de datos exitosa. Hora actual:', rows[0].now);
    } catch (err) {
        console.error('Error al iniciar el servidor:', err);
    }
});

process.on('uncaughtException', (err) => {
    console.error('Error no capturado:', err);
    process.exit(1);
});
