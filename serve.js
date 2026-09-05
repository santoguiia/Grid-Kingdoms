const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
    let safeUrl = req.url.split('?')[0];

    // Endpoint para salvar mapa criado no World Editor
    if (safeUrl === '/api/maps/save' && req.method === 'POST') {
        const mapsDir = path.join(__dirname, 'maps');
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            // Limitar tamanho de payload a 10MB
            if (body.length > 10 * 1024 * 1024) {
                req.connection.destroy();
            }
        });
        req.on('end', () => {
            try {
                const parsed = JSON.parse(body);
                const mapData = parsed.mapData || parsed;
                let rawName = (parsed.fileName || mapData.id || mapData.name || 'mapa_custom').toString();
                if (rawName.toLowerCase().endsWith('.json')) {
                    rawName = rawName.slice(0, -5);
                }
                // Sanitização estrita do nome de arquivo (evita Directory Traversal)
                let safeFileName = rawName.replace(/[^a-zA-Z0-9_\-]/g, '_').toLowerCase() + '.json';

                if (!fs.existsSync(mapsDir)) {
                    fs.mkdirSync(mapsDir, { recursive: true });
                }

                const targetPath = path.join(mapsDir, safeFileName);
                mapData.fileName = safeFileName;
                mapData.updatedAt = Date.now();

                fs.writeFileSync(targetPath, JSON.stringify(mapData, null, 2), 'utf8');

                res.writeHead(200, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Cache-Control': 'no-cache'
                });
                res.end(JSON.stringify({ success: true, fileName: safeFileName, map: mapData }));
            } catch (err) {
                console.error('[Maps] Erro ao salvar mapa:', err);
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: false, error: err.message }));
            }
        });
        return;
    }

    // Endpoint de API para listagem dinâmica de mapas na pasta /maps
    if (safeUrl === '/api/maps') {
        const mapsDir = path.join(__dirname, 'maps');
        try {
            if (!fs.existsSync(mapsDir)) {
                fs.mkdirSync(mapsDir, { recursive: true });
            }

            const files = fs.readdirSync(mapsDir);
            const mapList = [];

            for (const file of files) {
                if (file.toLowerCase().endsWith('.json')) {
                    const filePath = path.join(mapsDir, file);
                    try {
                        let raw = fs.readFileSync(filePath, 'utf8');
                        // Remover UTF-8 BOM se presente
                        if (raw.charCodeAt(0) === 0xFEFF) {
                            raw = raw.slice(1);
                        }
                        const parsed = JSON.parse(raw);
                        parsed.fileName = file;
                        if (!parsed.id) parsed.id = path.basename(file, '.json');
                        mapList.push(parsed);
                    } catch (parseErr) {
                        console.warn(`[Maps] Arquivo de mapa corrompido ou inválido ignorado: ${file}`, parseErr.message);
                        // Adiciona item com flag de erro para o frontend lidar com segurança
                        mapList.push({
                            id: path.basename(file, '.json'),
                            name: file,
                            fileName: file,
                            corrupted: true,
                            error: parseErr.message
                        });
                    }
                }
            }

            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            });
            res.end(JSON.stringify({ success: true, count: mapList.length, maps: mapList }));
            return;
        } catch (dirErr) {
            console.error('[Maps] Erro ao escanear diretório /maps:', dirErr);
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: false, error: dirErr.message, maps: [] }));
            return;
        }
    }

    let filePath = path.join(__dirname, safeUrl === '/' ? 'index.html' : safeUrl);
    
    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    });
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
});
