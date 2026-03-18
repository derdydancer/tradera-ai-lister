import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import 'dotenv/config';
import puppeteer from 'puppeteer';

async function startServer() {
  console.log(`[Server] Starting server process...`);
  console.log(`[Server] NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`[Server] Current working directory: ${process.cwd()}`);
  
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // Request logging middleware
  app.use((req, res, next) => {
    console.log(`[Server] ${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

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

  const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');
  if (!fs.existsSync(JOBS_FILE)) {
    fs.writeFileSync(JOBS_FILE, JSON.stringify([]));
  }
  const readJobs = () => JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
  const writeJobs = (data: any) => fs.writeFileSync(JOBS_FILE, JSON.stringify(data, null, 2));

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

  app.get('/api/config', (req, res) => {
    res.json({
      geminiApiKey: process.env.GEMINI_API_KEY || '',
    });
  });

  // API endpoint to fetch Tradera search results
  app.get('/api/tradera/search', async (req, res) => {
    const { q } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    try {
      const searchQuery = String(q);
      const url = `https://www.tradera.com/search?q=${encodeURIComponent(searchQuery)}&itemStatus=Sold`;
      console.log(`[Server] Fetching Tradera search results from: ${url}`);

      const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
      });
      const page = await browser.newPage();
      
      // Set user agent to avoid being blocked
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      // Wait for item cards to load
      await page.waitForSelector('[data-sentry-component="ItemCardGridItem"]', { timeout: 10000 });

      // Extract all item cards
      const searchResults = await page.evaluate(() => {
        const items = [];
        const itemCards = document.querySelectorAll('[data-sentry-component="ItemCardGridItem"]');
        
        itemCards.forEach(card => {
          // Get image
          const img = card.querySelector('img');
          const imageUrl = img ? img.src : '';

          // Get price
          const priceElement = card.querySelector('[data-testid="price"]');
          const price = priceElement ? priceElement.textContent?.trim() : '';

          // Get item link
          const linkElement = card.querySelector('a');
          const itemUrl = linkElement ? linkElement.href : '';

          // Get item title
          const titleElement = card.querySelector('h3');
          const title = titleElement ? titleElement.textContent?.trim() : '';

          items.push({
            title,
            price,
            imageUrl,
            itemUrl
          });
        });

        return items;
      });

      // Get the full HTML before closing the browser
      const fullHtml = await page.content();
      
      await browser.close();

      console.log(`[Server] Found ${searchResults.length} search results`);
      
      res.json({
        searchResults,
        html: fullHtml,
        url
      });

    } catch (error: any) {
      console.error('[Server] Failed to fetch Tradera search results:', error);
      res.status(500).json({
        error: 'Failed to fetch search results',
        details: error.message
      });
    }
  });

  // Jobs Endpoints
  app.get('/api/jobs', (req, res) => {
    res.json(readJobs());
  });

  app.post('/api/jobs', (req, res) => {
    const jobs = req.body.jobs || [req.body];
    const currentJobs = readJobs();
    const newJobs = jobs.map((j: any) => ({
      ...j,
      id: uuidv4(),
      status: 'pending',
      retries: 0,
      nextRunAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now()
    }));
    writeJobs([...currentJobs, ...newJobs]);
    res.json({ success: true, jobs: newJobs });
  });

  app.post('/api/jobs/claim', (req, res) => {
    const jobs = readJobs();
    const now = Date.now();
    
    let changed = false;
    jobs.forEach((j: any) => {
      // Reset stuck jobs (processing for > 5 minutes)
      if (j.status === 'processing' && now - j.updatedAt > 5 * 60 * 1000) {
        j.status = 'pending';
        j.updatedAt = now;
        changed = true;
      }
    });

    const jobIndex = jobs.findIndex((j: any) => j.status === 'pending' && j.nextRunAt <= now);
    
    if (jobIndex === -1) {
      if (changed) writeJobs(jobs);
      return res.json({ job: null });
    }
    
    const job = jobs[jobIndex];
    job.status = 'processing';
    job.updatedAt = now;
    writeJobs(jobs);
    
    res.json({ job });
  });

  app.post('/api/jobs/:id/success', (req, res) => {
    const jobs = readJobs();
    const job = jobs.find((j: any) => j.id === req.params.id);
    if (job) {
      job.status = 'completed';
      job.result = req.body.result;
      job.updatedAt = Date.now();
      writeJobs(jobs);
      
      const ads = readData();
      const adIndex = ads.findIndex((a: any) => a.id === job.adId);
      if (adIndex !== -1) {
        if (job.type === 'generate') {
          ads[adIndex] = { ...ads[adIndex], ...req.body.result };
        } else if (job.type === 'research') {
          ads[adIndex].ResearchReport = req.body.result.report;
        }
        writeData(ads);
      }
    }
    res.json({ success: true });
  });

  app.post('/api/jobs/:id/error', (req, res) => {
    const jobs = readJobs();
    const job = jobs.find((j: any) => j.id === req.params.id);
    if (job) {
      job.retries += 1;
      const backoff = Math.min(10000 * Math.pow(2, job.retries - 1), 3600000); // Max 1 hour
      job.nextRunAt = Date.now() + backoff;
      job.status = 'pending';
      job.error = req.body.error;
      job.updatedAt = Date.now();
      writeJobs(jobs);
    }
    res.json({ success: true });
  });

  app.put('/api/jobs/:id/pause', (req, res) => {
    const jobs = readJobs();
    const job = jobs.find((j: any) => j.id === req.params.id);
    if (job && (job.status === 'pending' || job.status === 'processing' || job.status === 'failed')) {
      job.status = 'paused';
      job.updatedAt = Date.now();
      writeJobs(jobs);
    }
    res.json({ success: true });
  });

  app.put('/api/jobs/:id/resume', (req, res) => {
    const jobs = readJobs();
    const job = jobs.find((j: any) => j.id === req.params.id);
    if (job && (job.status === 'paused' || job.status === 'pending')) {
      job.status = 'pending';
      job.nextRunAt = Date.now();
      job.updatedAt = Date.now();
      writeJobs(jobs);
    }
    res.json({ success: true });
  });

  app.delete('/api/jobs/:id', (req, res) => {
    let jobs = readJobs();
    jobs = jobs.filter((j: any) => j.id !== req.params.id);
    writeJobs(jobs);
    res.json({ success: true });
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
    console.log(`[Server] Running in production mode.`);
    console.log(`[Server] Serving static files from: ${distPath}`);
    
    if (fs.existsSync(distPath)) {
      console.log(`[Server] dist directory exists. Contents:`, fs.readdirSync(distPath));
      if (fs.existsSync(path.join(distPath, 'index.html'))) {
        console.log(`[Server] dist/index.html found.`);
      } else {
        console.error(`[Server] ERROR: dist/index.html is missing!`);
      }
    } else {
      console.error(`[Server] ERROR: dist directory is missing! Make sure to run 'npm run build' before starting the server.`);
    }

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
