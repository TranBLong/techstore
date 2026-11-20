import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { adminRequired } from '../middleware/auth.js';
import { validate } from '../utils/validate.js';

const router = Router();

const createContactSchema = z.object({
  fullName: z.string().trim().min(1, 'Vui lòng nhập họ tên').max(120),
  email: z.string().trim().email('Email không hợp lệ').max(254),
  message: z.string().trim().min(1, 'Vui lòng nhập nội dung').max(5000, 'Nội dung tối đa 5000 ký tự'),
});

router.post('/', validate(createContactSchema), async (req, res) => {
  const contact = await prisma.contact.create({ data: req.body });
  res.status(201).json({ id: contact.id, message: 'Đã gửi liên hệ thành công' });
});

router.get('/', adminRequired, async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 12));
  const skip = (page - 1) * limit;
  const [total, items] = await Promise.all([
    prisma.contact.count(),
    prisma.contact.findMany({ orderBy: { createdAt: 'desc' }, skip, take: limit }),
  ]);
  res.json({ items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 });
});

export default router;
