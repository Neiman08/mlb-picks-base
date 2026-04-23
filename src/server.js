import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import gamesRouter from './routes/games.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());

// 👉 SERVIR FRONTEND (ESTO ARREGLA EL "Cannot GET /")
app.use(express.static('public'));

// 👉 Ruta principal (abre index.html)
app.get('/', (req, res) => {
  res.sendFile(path.resolve('public/index.html'));
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'mlb-picks-base',
    timestamp: new Date().toISOString()
  });
});

// API routes
app.use('/api', gamesRouter);

// Error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({
    ok: false,
    error: err.message || 'Internal server error'
  });
});

// Start server
app.listen(port, () => {
  console.log(`🔥 MLB Picks corriendo en http://localhost:${port}`);
});