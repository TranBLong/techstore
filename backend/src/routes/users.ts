import { Router } from 'express';
import { prisma } from '../prisma.js';
import { adminRequired } from '../middleware/auth.js';

const router = Router();

router.get('/', adminRequired, async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(users.map(({ password, ...u }) => u));
});

router.patch('/:id', adminRequired, async (req, res) => {
  const id = String(req.params.id);
  const { role, isActive } = req.body || {};

  if (role !== undefined && role !== 'USER' && role !== 'ADMIN') {
    return res.status(400).json({ message: 'Role chỉ được là USER hoặc ADMIN' });
  }

  if (role !== undefined && req.user?.userId === id) {
    return res.status(400).json({ message: 'Không thể tự đổi role của chính mình' });
  }

  if (isActive !== undefined && typeof isActive !== 'boolean') {
    return res.status(400).json({ message: 'isActive phải là boolean' });
  }

  try {
    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(role !== undefined && { role }),
        ...(isActive !== undefined && { isActive }),
      },
    });
    const { password, ...safe } = user;
    res.json(safe);
  } catch {
    res.status(404).json({ message: 'Không tìm thấy user' });
  }
});

export default router;
