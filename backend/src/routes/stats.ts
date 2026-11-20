import { Router } from 'express';
import { prisma } from '../prisma.js';
import { adminRequired } from '../middleware/auth.js';
import { mapOrder } from '../utils/map.js';

const router = Router();

router.get('/dashboard', adminRequired, async (_req, res) => {
  const [productCount, userCount, orders, deliveredOrders, categories] = await Promise.all([
    prisma.product.count(),
    prisma.user.count(),
    prisma.order.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.order.findMany({ where: { status: 'delivered' }, select: { items: true } }),
    prisma.category.findMany({ include: { _count: { select: { products: true } } } }),
  ]);

  const revenue = orders
    .filter((o) => o.paymentStatus === 'paid' && o.status !== 'cancelled')
    .reduce((s, o) => s + o.total, 0);
  const byStatus: Record<string, number> = {};
  const byMonth: Record<string, number> = {};
  for (const o of orders) {
    byStatus[o.status] = (byStatus[o.status] || 0) + 1;
    if (o.paymentStatus === 'paid' && o.status !== 'cancelled') {
      const m = o.createdAt.toISOString().slice(0, 7);
      byMonth[m] = (byMonth[m] || 0) + o.total;
    }
  }

  const soldQuantities = new Map<string, number>();
  for (const order of deliveredOrders) {
    try {
      const items = JSON.parse(order.items) as Array<{ productId?: unknown; quantity?: unknown }>;
      for (const item of items) {
        if (typeof item.productId === 'string' && Number.isSafeInteger(item.quantity) && Number(item.quantity) > 0) {
          soldQuantities.set(item.productId, (soldQuantities.get(item.productId) || 0) + Number(item.quantity));
        }
      }
    } catch {
      console.error('Không thể đọc danh sách sản phẩm của một đơn đã giao');
    }
  }
  const bestSellerIds = [...soldQuantities.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([productId]) => productId);
  const products = bestSellerIds.length
    ? await prisma.product.findMany({
        where: { id: { in: bestSellerIds } },
        include: { category: true },
      })
    : [];
  const productById = new Map(products.map((product) => [product.id, product]));

  res.json({
    totalRevenue: revenue,
    totalOrders: orders.length,
    totalProducts: productCount,
    totalUsers: userCount,
    revenueByMonth: Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, value]) => ({ month, revenue: value })),
    ordersByStatus: Object.entries(byStatus).map(([status, count]) => ({ status, count })),
    bestSellers: bestSellerIds.flatMap((id) => {
      const p = productById.get(id);
      if (!p) return [];
      return [{
        ...p,
        images: JSON.parse(p.images || '[]'),
        categoryName: p.category.name,
        soldQuantity: soldQuantities.get(id) || 0,
      }];
    }),
    categoryStats: categories.map((c) => ({ name: c.name, count: c._count.products })),
    recentOrders: orders.slice(0, 8).map(mapOrder),
  });
});

export default router;
