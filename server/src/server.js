import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import slabRoutes from './routes/slabRoutes.js';
import beamRoutes from './routes/beamRoutes.js';
import columnRoutes from './routes/columnRoutes.js';
import footingRoutes from './routes/footingRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import authRoutes from './routes/authRoutes.js';
import historyRoutes from './routes/historyRoutes.js';
import { authenticate } from './middleware/authenticate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 5000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', message: 'Automatic Rebar Detailing System API is running' });
});

app.use('/api/auth', authRoutes);
app.use('/api/slabs', authenticate, slabRoutes);
app.use('/api/beams', authenticate, beamRoutes);
app.use('/api/columns', authenticate, columnRoutes);
app.use('/api/footings', authenticate, footingRoutes);
app.use('/api/reports', authenticate, reportRoutes);
app.use('/api/history', authenticate, historyRoutes);

export default app;

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/rebar-detailing-system')
    .then(() => {
      console.log('MongoDB connected');
      app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
    })
    .catch((error) => {
      console.error('MongoDB connection failed', error);
      app.listen(PORT, () => console.log(`Server listening on port ${PORT} without DB`));
    });
}
