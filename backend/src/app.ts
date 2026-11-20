import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';
import productRoutes from './routes/products.js';
import categoryRoutes from './routes/categories.js';
import orderRoutes from './routes/orders.js';
import userRoutes from './routes/users.js';
import statsRoutes from './routes/stats.js';
import couponRoutes from './routes/coupons.js';
import reviewRoutes from './routes/reviews.js';
import wishlistRoutes from './routes/wishlist.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const frontendOrigin = process.env.FRONTEND_URL || 'http://localhost:5173';

app.use(
  helmet({
    // Cho phép frontend tải ảnh tĩnh từ /images (CORP mặc định của helmet là same-origin)
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);
app.use(
  cors({
    origin: frontendOrigin,
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use('/images', express.static(path.join(__dirname, '../public/images')));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/users', userRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api', reviewRoutes);
app.use('/api/wishlist', wishlistRoutes);

export default app;
