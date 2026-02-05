import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    server: {
        host: true,
        port: 5173,
        watch: {
            ignored: ['**/hotspots.json']  // Don't reload when hotspots.json changes
        }
    },
    plugins: [
        {
            name: 'admin-api',
            configureServer(server) {
                // Middleware 1: Save Hotspots
                server.middlewares.use('/api/save-hotspots', (req, res, next) => {
                    if (req.method === 'POST') {
                        let body = '';
                        req.on('data', chunk => {
                            body += chunk.toString();
                        });
                        req.on('end', () => {
                            try {
                                const filePath = path.resolve(__dirname, 'src/data/hotspots.json');
                                // Validate JSON before writing
                                JSON.parse(body);
                                fs.writeFileSync(filePath, body);
                                res.statusCode = 200;
                                res.setHeader('Content-Type', 'application/json');
                                res.end(JSON.stringify({ success: true }));
                                console.log('Hotspots saved successfully to ' + filePath);
                            } catch (err) {
                                console.error('Error saving hotspots:', err);
                                res.statusCode = 500;
                                res.end(JSON.stringify({ error: err.message }));
                            }
                        });
                    } else {
                        next();
                    }
                });

                // Middleware 1.5: Get Hotspots (Dynamic)
                server.middlewares.use('/api/get-hotspots', (req, res, next) => {
                    if (req.method === 'GET') {
                        try {
                            const filePath = path.resolve(__dirname, 'src/data/hotspots.json');
                            if (fs.existsSync(filePath)) {
                                const data = fs.readFileSync(filePath, 'utf-8');
                                res.statusCode = 200;
                                res.setHeader('Content-Type', 'application/json');
                                res.end(data);
                            } else {
                                res.statusCode = 200;
                                res.end('{}'); // Return empty object if no file
                            }
                        } catch (err) {
                            console.error('Error reading hotspots:', err);
                            res.statusCode = 500;
                            res.end(JSON.stringify({ error: err.message }));
                        }
                    } else {
                        next();
                    }
                });

                // Middleware 2: List Scenes
                server.middlewares.use('/api/list-scenes', (req, res, next) => {
                    if (req.method === 'GET') {
                        try {
                            const museumDir = path.resolve(__dirname, 'public/assets/Museum Kota Makassar');
                            if (fs.existsSync(museumDir)) {
                                const files = fs.readdirSync(museumDir).filter(f => f.match(/\.(jpg|jpeg|png)$/i));

                                const scenes = files.map(file => ({
                                    filename: file,
                                    path: 'assets/Museum Kota Makassar/' + file
                                }));

                                res.statusCode = 200;
                                res.setHeader('Content-Type', 'application/json');
                                res.end(JSON.stringify(scenes));
                            } else {
                                res.statusCode = 404;
                                res.end(JSON.stringify({ error: 'Directory not found' }));
                            }
                        } catch (err) {
                            res.statusCode = 500;
                            res.end(JSON.stringify({ error: err.message }));
                        }
                    } else {
                        next();
                    }
                });
            }
        }
    ]
});
