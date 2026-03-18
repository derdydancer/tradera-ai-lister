import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import 'dotenv/config';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // Ensure data directory exists
  const DATA_DIR = path.join(process.cwd(), 'data');
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Ensure uploads directory exists
  const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  const DATA_FILE = path.join(DATA_DIR, 'ads.json');

  // Initialize data file if it doesn't exist
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([]));
  }

  // Serve uploaded files
  app.use('/uploads', express.static(UPLOADS_DIR));

  // Multer setup for file uploads
  const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, UPLOADS_DIR);
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, uniqueSuffix + path.extname(file.originalname));
    }
  });
  const upload = multer({ storage: storage });

  // Helper to read/write data
  const readData = () => JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  const writeData = (data: any) => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

  // API Routes
  app.get('/api/ads', (req, res) => {
    res.json(readData());
  });

  app.post('/api/ads', (req, res) => {
    const ads = readData();
    const newAd = { id: uuidv4(), ...req.body, createdAt: new Date().toISOString() };
    ads.push(newAd);
    writeData(ads);
    res.json(newAd);
  });

  app.put('/api/ads/:id', (req, res) => {
    const ads = readData();
    const index = ads.findIndex((a: any) => a.id === req.params.id);
    if (index !== -1) {
      ads[index] = { ...ads[index], ...req.body, updatedAt: new Date().toISOString() };
      writeData(ads);
      res.json(ads[index]);
    } else {
      res.status(404).json({ error: 'Ad not found' });
    }
  });

  app.delete('/api/ads/:id', (req, res) => {
    let ads = readData();
    ads = ads.filter((a: any) => a.id !== req.params.id);
    writeData(ads);
    res.json({ success: true });
  });

  app.post('/api/upload', upload.array('images'), (req, res) => {
    if (!req.files) {
      return res.status(400).json({ error: 'No files uploaded' });
    }
    const files = req.files as Express.Multer.File[];
    const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
    const urls = files.map(f => `${appUrl}/uploads/${f.filename}`);
    res.json({ urls });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
