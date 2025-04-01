const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const app = express();

app.use(express.json());

// Configurar Multer para manejar subidas de archivos
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/'); // Carpeta donde se guardarán los archivos
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname)); // Nombre único
    }
});
const upload = multer({ storage: storage });

// Conectar a PostgreSQL usando DATABASE_URL de Railway
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Necesario para conexiones en Railway
});

// Ruta de prueba
app.get('/api/test', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT NOW()'); // Prueba la conexión a la DB
        res.json({ 
            message: '¡El servidor está funcionando!', 
            dbTime: rows[0].now 
        });
    } catch (err) {
        console.error('Error al conectar a la base de datos:', err);
        res.status(500).json({ message: 'Error en la base de datos', error: err.message });
    }
});

// Ejemplo: Obtener usuarios
app.get('/api/users', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM users');
        res.json(rows);
    } catch (err) {
        console.error('Error al consultar usuarios:', err);
        res.status(500).json({ error: 'Error en el servidor' });
    }
});

// Ruta para subir un archivo (ejemplo: foto de perfil)
app.post('/api/upload-profile-picture', upload.single('profilePicture'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se subió ningún archivo' });
        }
        const filePath = req.file.path;
        const userId = req.body.userId; // Suponiendo que envías el ID del usuario

        // Actualizar la base de datos con la ruta del archivo
        const query = 'UPDATE users SET profilePicture = $1 WHERE id = $2 RETURNING *';
        const { rows } = await pool.query(query, [filePath, userId]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        res.json({ message: 'Archivo subido exitosamente', user: rows[0] });
    } catch (err) {
        console.error('Error al subir archivo:', err);
        res.status(500).json({ error: 'Error en el servidor' });
    }
});

// Iniciar servidor
const PORT = process.env.PORT || 5432; // Cambiado de 3000 a 5432
app.listen(PORT, async () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
    // Verificar conexión a la base de datos al iniciar
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
