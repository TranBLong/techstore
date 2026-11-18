import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '../prisma.js';
import { authRequired, signToken } from '../middleware/auth.js';

const router = Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ message: 'Thiếu email hoặc mật khẩu' });
  const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } });
  if (!user) return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng' });
  if (!user.isActive) return res.status(403).json({ message: 'Tài khoản đã bị khóa' });
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng' });
  const token = signToken({ userId: user.id, email: user.email, role: user.role });
  const { password: _, ...safe } = user;
  res.json({ token, user: safe });
});

router.post('/register', async (req, res) => {
  const { email, password, fullName, phone } = req.body || {};
  if (!email || !password || !fullName) return res.status(400).json({ message: 'Thiếu thông tin bắt buộc' });
  const exists = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } });
  if (exists) return res.status(400).json({ message: 'Email đã được sử dụng' });
  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email: String(email).toLowerCase(),
      password: hash,
      fullName,
      phone: phone || '',
      role: 'USER',
    },
  });
  const token = signToken({ userId: user.id, email: user.email, role: user.role });
  const { password: _, ...safe } = user;
  res.status(201).json({ token, user: safe });
});

router.get('/me', authRequired, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) return res.status(404).json({ message: 'Không tìm thấy user' });
  const { password: _, ...safe } = user;
  res.json(safe);
});

router.put('/profile', authRequired, async (req, res) => {
  const { fullName, phone, address, city, district } = req.body || {};
  const user = await prisma.user.update({
    where: { id: req.user!.userId },
    data: {
      ...(fullName !== undefined && { fullName }),
      ...(phone !== undefined && { phone }),
      ...(address !== undefined && { address }),
      ...(city !== undefined && { city }),
      ...(district !== undefined && { district }),
    },
  });
  const { password: _, ...safe } = user;
  res.json(safe);
});

router.put('/password', authRequired, async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) return res.status(404).json({ message: 'Không tìm thấy user' });
  const ok = await bcrypt.compare(oldPassword || '', user.password);
  if (!ok) return res.status(400).json({ message: 'Mật khẩu cũ không đúng' });
  const hash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { password: hash } });
  res.json({ message: 'Đổi mật khẩu thành công' });
});

/** Quên mật khẩu — luôn trả thông báo chung, không lộ email có tồn tại hay không */
router.post('/forgot-password', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const genericMessage =
    'Nếu email tồn tại trong hệ thống, chúng tôi đã gửi hướng dẫn đặt lại mật khẩu.';

  if (!email) {
    return res.status(400).json({ message: 'Vui lòng nhập email' });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    return res.json({ message: genericMessage });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 phút

  await prisma.passwordReset.create({
    data: { userId: user.id, tokenHash, expiresAt },
  });

  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  const resetLink = `${frontendUrl}/dat-lai-mat-khau?token=${token}`;
  console.log(`[PasswordReset] Link đặt lại mật khẩu cho ${email}: ${resetLink}`);

  const payload: { message: string; resetToken?: string } = { message: genericMessage };
  if (process.env.NODE_ENV !== 'production') {
    payload.resetToken = token;
  }
  res.json(payload);
});

/** Đặt lại mật khẩu bằng token */
router.post('/reset-password', async (req, res) => {
  const token = String(req.body?.token || '').trim();
  const password = String(req.body?.password || '');

  if (!token) return res.status(400).json({ message: 'Thiếu token đặt lại mật khẩu' });
  if (!password || password.length < 6) {
    return res.status(400).json({ message: 'Mật khẩu phải có ít nhất 6 ký tự' });
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const record = await prisma.passwordReset.findUnique({ where: { tokenHash } });

  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
    return res.status(400).json({ message: 'Token không hợp lệ hoặc đã hết hạn' });
  }

  const hash = await bcrypt.hash(password, 10);
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { password: hash } }),
    prisma.passwordReset.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);

  res.json({ message: 'Đặt lại mật khẩu thành công' });
});

export default router;
