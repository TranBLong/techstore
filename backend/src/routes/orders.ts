import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { authRequired, adminRequired } from '../middleware/auth.js';
import { mapOrder } from '../utils/map.js';
import { validate } from '../utils/validate.js';
import { assertCouponUsable } from './coupons.js';

const router = Router();

/** Phí ship: miễn phí nếu tạm tính > 5.000.000đ (cùng rule frontend) */
const FREE_SHIP_THRESHOLD = 5_000_000;
const SHIPPING_FEE = 30_000;

const vnPhoneRegex = /^(0|\+84)[0-9]{9,10}$/;

const shippingInfoSchema = z.object({
  fullName: z
    .string({ error: 'Họ tên không được để trống' })
    .trim()
    .min(1, 'Họ tên không được để trống'),
  address: z
    .string({ error: 'Địa chỉ không được để trống' })
    .trim()
    .min(1, 'Địa chỉ không được để trống'),
  city: z
    .string({ error: 'Tỉnh/Thành phố không được để trống' })
    .trim()
    .min(1, 'Tỉnh/Thành phố không được để trống'),
  district: z
    .string({ error: 'Quận/Huyện không được để trống' })
    .trim()
    .min(1, 'Quận/Huyện không được để trống'),
  phone: z
    .string({ error: 'Số điện thoại không hợp lệ' })
    .trim()
    .regex(vnPhoneRegex, 'Số điện thoại không hợp lệ (bắt đầu bằng 0 hoặc +84, 10-11 chữ số)'),
  email: z
    .string({ error: 'Email không hợp lệ' })
    .trim()
    .email('Email không hợp lệ'),
  note: z
    .string()
    .max(500, 'Ghi chú tối đa 500 ký tự')
    .optional()
    .default(''),
});

const createOrderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1, 'Giỏ hàng trống'),
  shippingInfo: shippingInfoSchema,
  paymentMethod: z.enum(['cod', 'transfer']).optional().default('cod'),
  couponCode: z.string().optional(),
});

router.get('/my', authRequired, async (req, res) => {
  const list = await prisma.order.findMany({
    where: { userId: req.user!.userId },
    orderBy: { createdAt: 'desc' },
    include: { statusLogs: { orderBy: { createdAt: 'asc' } } },
  });
  res.json(list.map(mapOrder));
});

router.get('/', adminRequired, async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 12));
  const skip = (page - 1) * limit;
  const [total, list] = await Promise.all([
    prisma.order.count(),
    prisma.order.findMany({
      orderBy: { createdAt: 'desc' }, skip, take: limit,
      include: { statusLogs: { orderBy: { createdAt: 'asc' } } },
    }),
  ]);
  res.json({ items: list.map(mapOrder), total, page, limit, totalPages: Math.ceil(total / limit) || 1 });
});

router.get('/:id', authRequired, async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { id: String(req.params.id) },
    include: { statusLogs: { orderBy: { createdAt: 'asc' } } },
  });
  if (!order) return res.status(404).json({ message: 'Không tìm thấy đơn' });
  if (req.user!.role !== 'ADMIN' && order.userId !== req.user!.userId) {
    return res.status(403).json({ message: 'Không có quyền' });
  }
  res.json(mapOrder(order));
});

/**
 * Đặt hàng: server tự lấy giá từ DB, kiểm tra tồn kho, tính subtotal / ship / total,
 * trừ kho trong transaction — không tin số tiền client gửi lên.
 */
router.post('/', authRequired, validate(createOrderSchema), async (req, res) => {
  const body = req.body;
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) return res.status(401).json({ message: 'Chưa đăng nhập' });

  const rawItems: { productId: string; quantity: number }[] = body.items;

  // Gom số lượng theo productId (tránh trùng dòng)
  const qtyMap = new Map<string, number>();
  for (const it of rawItems) {
    const id = String(it.productId || '').trim();
    const qty = Number(it.quantity);
    if (!id || !Number.isSafeInteger(qty) || qty <= 0) {
      return res.status(400).json({ message: 'Mỗi sản phẩm cần productId và quantity > 0' });
    }
    qtyMap.set(id, (qtyMap.get(id) || 0) + Math.floor(qty));
  }

  const productIds = [...qtyMap.keys()];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
  });
  const productById = new Map(products.map((p) => [p.id, p]));

  // Kiểm tra tồn tại / trạng thái / tồn kho (trước khi vào transaction)
  const orderItems: {
    productId: string;
    productName: string;
    productImage: string;
    price: number;
    quantity: number;
  }[] = [];

  for (const [productId, quantity] of qtyMap) {
    const p = productById.get(productId);
    if (!p) {
      return res.status(400).json({ message: `Không tìm thấy sản phẩm: ${productId}` });
    }
    if (p.status !== 'active') {
      return res.status(400).json({ message: `Sản phẩm "${p.name}" đang ngừng bán` });
    }
    if (p.stock < quantity) {
      return res.status(400).json({
        message: `Sản phẩm "${p.name}" chỉ còn ${p.stock} trong kho (bạn chọn ${quantity})`,
      });
    }

    // Giá lấy từ DB, ưu tiên salePrice
    const unitPrice = p.salePrice != null ? p.salePrice : p.price;
    let images: string[] = [];
    try {
      images = JSON.parse(p.images || '[]');
    } catch {
      images = [];
    }

    orderItems.push({
      productId: p.id,
      productName: p.name,
      productImage: images[0] || '',
      price: unitPrice,
      quantity,
    });
  }

  // Server tự tính tiền
  const subtotal = orderItems.reduce((s, i) => s + i.price * i.quantity, 0);
  const shippingFee = subtotal > FREE_SHIP_THRESHOLD || subtotal === 0 ? 0 : SHIPPING_FEE;
  const couponCode = String(body.couponCode || '').trim().toUpperCase();
  let discount = 0;
  let couponId: string | null = null;
  if (couponCode) {
    const coupon = await prisma.coupon.findUnique({ where: { code: couponCode } });
    const result = assertCouponUsable(coupon, subtotal);
    if (!result.ok) return res.status(400).json({ message: result.message });
    discount = result.discount;
    couponId = coupon!.id;
  }
  const total = Math.max(0, subtotal - discount + shippingFee);

  const shippingInfo = body.shippingInfo;
  const paymentMethod = body.paymentMethod === 'transfer' ? 'transfer' : 'cod';

  try {
    const order = await prisma.$transaction(async (tx) => {
      // Trong transaction: kiểm tra lại tồn kho (tránh race) rồi trừ
      for (const item of orderItems) {
        const updated = await tx.product.updateMany({
          where: {
            id: item.productId,
            stock: { gte: item.quantity },
            status: 'active',
          },
          data: { stock: { decrement: item.quantity } },
        });
        if (updated.count === 0) {
          throw new Error(
            `Không đủ tồn kho cho sản phẩm "${item.productName}" (có thể vừa bị đặt hết)`
          );
        }
      }

      if (couponId) {
        const coupon = await tx.coupon.findUnique({ where: { id: couponId } });
        const result = assertCouponUsable(coupon, subtotal);
        if (!result.ok || result.discount !== discount) {
          throw new Error(result.ok ? 'Mã giảm giá đã thay đổi, vui lòng áp dụng lại' : result.message);
        }

        const updated = await tx.coupon.updateMany({
          where: {
            id: couponId,
            isActive: true,
            AND: [
              { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
              ...(coupon!.usageLimit == null ? [] : [{ usedCount: { lt: coupon!.usageLimit! } }]),
            ],
          },
          data: { usedCount: { increment: 1 } },
        });
        if (updated.count !== 1) {
          throw new Error('Mã giảm giá đã hết lượt sử dụng hoặc hết hạn');
        }
      }

      const created = await tx.order.create({
        data: {
          userId: user.id,
          userName: shippingInfo.fullName || user.fullName,
          userEmail: shippingInfo.email || user.email,
          items: JSON.stringify(orderItems),
          subtotal,
          discount,
          shippingFee,
          total,
          status: 'pending',
          paymentMethod,
          couponCode: couponCode || null,
          shippingInfo: JSON.stringify(shippingInfo),
        },
      });
      await tx.orderStatusLog.create({ data: { orderId: created.id, status: 'pending', changedBy: user.id } });
      return tx.order.findUniqueOrThrow({
        where: { id: created.id }, include: { statusLogs: { orderBy: { createdAt: 'asc' } } },
      });
    });

    res.status(201).json(mapOrder(order));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Đặt hàng thất bại';
    // Lỗi tồn kho / nghiệp vụ → 400; lỗi khác → 500
    const isBusinessError =
      message.includes('tồn kho') || message.includes('Không đủ') || message.includes('Mã giảm giá');
    res.status(isBusinessError ? 400 : 500).json({ message });
  }
});

router.patch('/:id/status', adminRequired, async (req, res) => {
  const status = String(req.body?.status || '');
  const allowed = ['pending', 'processing', 'shipping', 'delivered', 'cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ message: 'Trạng thái không hợp lệ' });
  try {
    const id = String(req.params.id);
    const order = await prisma.$transaction(async (tx) => {
      const current = await tx.order.findUnique({ where: { id } });
      if (!current) throw new Error('NOT_FOUND');
      if (current.status === 'cancelled' || current.status === 'delivered') {
        throw new Error('Không thể đổi trạng thái đơn đã giao hoặc đã hủy');
      }
      if (status === current.status) return tx.order.findUniqueOrThrow({
        where: { id }, include: { statusLogs: { orderBy: { createdAt: 'asc' } } },
      });
      if (status === 'cancelled') {
        if (!['pending', 'processing'].includes(current.status)) {
          throw new Error('Chỉ hủy được đơn đang chờ xác nhận hoặc đang xử lý');
        }
        let items: { productId: string; quantity: number }[] = [];
        try { items = JSON.parse(current.items || '[]'); } catch { items = []; }
        for (const item of items) {
          const productId = String(item.productId || '');
          const quantity = Number(item.quantity) || 0;
          if (productId && quantity > 0) await tx.product.update({
            where: { id: productId }, data: { stock: { increment: quantity } },
          });
        }
        // Hoàn lượt dùng mã giảm giá (nếu có)
        if (current.couponCode) {
          await tx.coupon.updateMany({
            where: { code: current.couponCode, usedCount: { gt: 0 } },
            data: { usedCount: { decrement: 1 } },
          });
        }
      }
      await tx.order.update({ where: { id }, data: { status } });
      await tx.orderStatusLog.create({ data: { orderId: id, status, changedBy: req.user!.userId } });
      return tx.order.findUniqueOrThrow({
        where: { id }, include: { statusLogs: { orderBy: { createdAt: 'asc' } } },
      });
    });
    res.json(mapOrder(order));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Cập nhật thất bại';
    if (message === 'NOT_FOUND') return res.status(404).json({ message: 'Không tìm thấy đơn' });
    res.status(400).json({ message });
  }
});

/** User hủy đơn của mình */
router.post('/:id/cancel', authRequired, async (req, res) => {
  const id = String(req.params.id);
  try {
    const order = await prisma.$transaction(async (tx) => {
      const current = await tx.order.findUnique({ where: { id } });
      if (!current) throw new Error('NOT_FOUND');
      if (current.userId !== req.user!.userId && req.user!.role !== 'ADMIN') throw new Error('FORBIDDEN');
      if (!['pending', 'processing'].includes(current.status)) {
        throw new Error(current.status === 'cancelled' ? 'Đơn đã được hủy trước đó' : 'Chỉ hủy được đơn đang chờ xác nhận hoặc đang xử lý');
      }
      let items: { productId: string; quantity: number }[] = [];
      try { items = JSON.parse(current.items || '[]'); } catch { items = []; }
      for (const item of items) {
        const productId = String(item.productId || '');
        const quantity = Number(item.quantity) || 0;
        if (productId && quantity > 0) await tx.product.update({
          where: { id: productId }, data: { stock: { increment: quantity } },
        });
      }
      // Hoàn lượt dùng mã giảm giá (nếu có)
      if (current.couponCode) {
        await tx.coupon.updateMany({
          where: { code: current.couponCode, usedCount: { gt: 0 } },
          data: { usedCount: { decrement: 1 } },
        });
      }
      await tx.order.update({ where: { id }, data: { status: 'cancelled' } });
      await tx.orderStatusLog.create({ data: { orderId: id, status: 'cancelled', changedBy: req.user!.userId } });
      return tx.order.findUniqueOrThrow({
        where: { id }, include: { statusLogs: { orderBy: { createdAt: 'asc' } } },
      });
    });
    res.json(mapOrder(order));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Hủy đơn thất bại';
    if (message === 'NOT_FOUND') return res.status(404).json({ message: 'Không tìm thấy đơn' });
    if (message === 'FORBIDDEN') return res.status(403).json({ message: 'Không có quyền' });
    res.status(400).json({ message });
  }
});

export default router;
