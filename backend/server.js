const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend'))); // Sirve frontend/

// Ruta raíz para servir index.html
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, '..', 'frontend', 'index.html');
    console.log('Directorio actual (__dirname):', __dirname);
    console.log('Intentando servir:', indexPath);
    if (fs.existsSync(indexPath)) {
        console.log('Archivo encontrado, sirviendo index.html');
        res.sendFile(indexPath);
    } else {
        console.error('Archivo no encontrado en:', indexPath);
        res.status(404).send('Error: No se encontró index.html en frontend/. Revisa la estructura o el despliegue.');
    }
});

// Ruta de prueba
app.get('/api/test', (req, res) => {
    res.json({ message: '¡El servidor está funcionando!', dir: __dirname });
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
    console.log('Estructura de directorios en el servidor:');
    fs.readdir(__dirname, (err, files) => {
        if (err) console.error('Error al leer directorio:', err);
        else console.log('Contenido de backend/:', files);
    });
    fs.readdir(path.join(__dirname, '..'), (err, files) => {
        if (err) console.error('Error al leer directorio padre:', err);
        else console.log('Contenido de uv-messages/:', files);
    });
});

// Manejar errores no capturados
process.on('uncaughtException', (err) => {
    console.error('Error no capturado:', err);
});
