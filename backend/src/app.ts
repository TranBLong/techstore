import express from 'express';
import type { ErrorRequestHandler, Request, Response, NextFunction } from 'express';
import 'express-async-errors';
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

/** 404 chỉ cho đường dẫn /api/* */
app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({ message: 'Không tìm thấy đường dẫn' });
});

/** Middleware lỗi chung — phải đặt cuối cùng */
const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Dữ liệu JSON không hợp lệ' });
  }

  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Dữ liệu gửi lên quá lớn' });
  }

  console.error(err);
  res.status(500).json({ message: 'Lỗi máy chủ, vui lòng thử lại sau' });
};

app.use(errorHandler);

export default app;
