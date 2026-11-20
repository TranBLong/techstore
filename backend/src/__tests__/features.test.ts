import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import { prisma } from '../prisma.js';

describe('Các chức năng bổ sung', () => {
  let adminToken = '';
  let userToken = '';
  let adminId = '';
  let userId = '';
  let categoryId = '';
  let productId = '';

  beforeAll(async () => {
    await prisma.orderStatusLog.deleteMany();
    await prisma.review.deleteMany();
    await prisma.wishlist.deleteMany();
    await prisma.contact.deleteMany();
    await prisma.passwordReset.deleteMany();
    await prisma.order.deleteMany();
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    await prisma.coupon.deleteMany();
    await prisma.user.deleteMany();

    const passwordHash = await bcrypt.hash('test1234', 10);
    const admin = await prisma.user.create({
      data: { email: 'features-admin@test.com', password: passwordHash, fullName: 'Admin Features', role: 'ADMIN' },
    });
    const user = await prisma.user.create({
      data: { email: 'features-user@test.com', password: passwordHash, fullName: 'User Features', role: 'USER' },
    });
    const category = await prisma.category.create({
      data: { name: 'Features Cat', slug: 'features-cat', description: '' },
    });
    const product = await prisma.product.create({
      data: {
        name: 'Features Phone', slug: 'features-phone', categoryId: category.id, brand: 'Test',
        price: 1_000_000, stock: 5, status: 'active', images: '[]', specs: '{}',
      },
    });

    adminId = admin.id;
    userId = user.id;
    categoryId = category.id;
    productId = product.id;

    const adminLogin = await request(app).post('/api/auth/login')
      .send({ email: 'features-admin@test.com', password: 'test1234' });
    const userLogin = await request(app).post('/api/auth/login')
      .send({ email: 'features-user@test.com', password: 'test1234' });
    adminToken = adminLogin.body.token;
    userToken = userLogin.body.token;

    expect(adminToken).toBeTruthy();
    expect(userToken).toBeTruthy();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createCoupon(data: {
    code: string;
    type?: string;
    value?: number;
    minOrder?: number;
    maxDiscount?: number | null;
    usageLimit?: number | null;
    usedCount?: number;
    expiresAt?: Date | null;
    isActive?: boolean;
  }) {
    return prisma.coupon.create({
      data: {
        code: data.code,
        type: data.type ?? 'fixed',
        value: data.value ?? 10_000,
        minOrder: data.minOrder ?? 0,
        maxDiscount: data.maxDiscount ?? null,
        usageLimit: data.usageLimit ?? null,
        usedCount: data.usedCount ?? 0,
        expiresAt: data.expiresAt ?? null,
        isActive: data.isActive ?? true,
      },
    });
  }

  async function createProduct(stock = 5) {
    return prisma.product.create({
      data: {
        name: 'Order Features Phone',
        slug: `order-features-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        categoryId,
        brand: 'Test',
        price: 1_000_000,
        stock,
        status: 'active',
        images: '[]',
        specs: '{}',
      },
    });
  }

  async function createOrder(options: {
    productId: string;
    couponCode?: string;
    paymentMethod?: 'cod' | 'transfer';
  }) {
    return request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        items: [{ productId: options.productId, quantity: 1 }],
        paymentMethod: options.paymentMethod ?? 'cod',
        ...(options.couponCode ? { couponCode: options.couponCode } : {}),
        shippingInfo: {
          fullName: 'User Features',
          phone: '0900000000',
          email: 'features-user@test.com',
          address: '1 Test',
          city: 'HN',
          district: 'HK',
        },
      });
  }

  it('token cũ bị từ chối khi tài khoản bị khóa và role admin được kiểm tra lại từ DB', async () => {
    try {
      await prisma.user.update({ where: { id: userId }, data: { isActive: false } });
      const lockedResponse = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${userToken}`);
      expect(lockedResponse.status).toBe(401);

      await prisma.user.update({ where: { id: adminId }, data: { role: 'USER' } });
      const downgradedResponse = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(downgradedResponse.status).toBe(403);
    } finally {
      await prisma.user.update({ where: { id: userId }, data: { isActive: true } });
      await prisma.user.update({ where: { id: adminId }, data: { role: 'ADMIN' } });
    }
  });

  it('lưu liên hệ từ khách và chỉ admin xem được danh sách', async () => {
    const submitted = await request(app)
      .post('/api/contacts')
      .send({ fullName: 'Nguyễn An', email: 'an@example.com', message: 'Tôi cần hỗ trợ.' });
    expect(submitted.status).toBe(201);

    const denied = await request(app)
      .get('/api/contacts')
      .set('Authorization', `Bearer ${userToken}`);
    expect(denied.status).toBe(403);

    const listed = await request(app)
      .get('/api/contacts')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listed.status).toBe(200);
    expect(listed.body.items[0]).toMatchObject({
      fullName: 'Nguyễn An',
      email: 'an@example.com',
      message: 'Tôi cần hỗ trợ.',
    });
  });

  it('dashboard chỉ tính doanh thu đã thanh toán và xếp bán chạy theo sản phẩm đã giao', async () => {
    const product = await createProduct(10);
    const before = await request(app)
      .get('/api/stats/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(before.status).toBe(200);

    const created = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        items: [{ productId: product.id, quantity: 4 }],
        paymentMethod: 'transfer',
        shippingInfo: {
          fullName: 'User Features',
          phone: '0900000000',
          email: 'features-user@test.com',
          address: '1 Test',
          city: 'HN',
          district: 'HK',
        },
      });
    expect(created.status).toBe(201);
    const orderId = created.body.id;
    await request(app).patch(`/api/orders/${orderId}/payment`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ paymentStatus: 'paid' });
    for (const status of ['processing', 'shipping', 'delivered']) {
      await request(app).patch(`/api/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status });
    }

    const unpaid = await createOrder({ productId: product.id, paymentMethod: 'transfer' });
    expect(unpaid.status).toBe(201);
    const after = await request(app)
      .get('/api/stats/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(after.body.totalRevenue).toBe(before.body.totalRevenue + created.body.total);
    expect(after.body.bestSellers.find((item: { id: string }) => item.id === product.id))
      .toMatchObject({ soldQuantity: 4 });
  });

  describe('Mã giảm giá', () => {
    it('validate mã phần trăm thành công và áp dụng maxDiscount', async () => {
      await createCoupon({ code: 'FEATURES-PERCENT', type: 'percent', value: 20, maxDiscount: 50_000 });

      const response = await request(app)
        .post('/api/coupons/validate')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ code: ' features-percent ', subtotal: 500_000 });

      expect(response.status).toBe(200);
      expect(response.body.discount).toBe(50_000);
    });

    it('từ chối mã khi đơn dưới minOrder', async () => {
      await createCoupon({ code: 'FEATURES-MINIMUM', minOrder: 500_000 });

      const response = await request(app)
        .post('/api/coupons/validate')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ code: 'FEATURES-MINIMUM', subtotal: 499_999 });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/đơn hàng tối thiểu/i);
    });

    it('từ chối mã đã hết hạn', async () => {
      await createCoupon({ code: 'FEATURES-EXPIRED', expiresAt: new Date(Date.now() - 60_000) });

      const response = await request(app)
        .post('/api/coupons/validate')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ code: 'FEATURES-EXPIRED', subtotal: 100_000 });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/hết hạn/i);
    });

    it('từ chối mã đã bị vô hiệu hóa', async () => {
      await createCoupon({ code: 'FEATURES-INACTIVE', isActive: false });

      const response = await request(app)
        .post('/api/coupons/validate')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ code: 'FEATURES-INACTIVE', subtotal: 100_000 });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/vô hiệu hóa/i);
    });

    it('từ chối mã đã hết lượt sử dụng', async () => {
      await createCoupon({ code: 'FEATURES-EXHAUSTED', usageLimit: 1, usedCount: 1 });

      const response = await request(app)
        .post('/api/coupons/validate')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ code: 'FEATURES-EXHAUSTED', subtotal: 100_000 });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/hết lượt sử dụng/i);
    });

    it('đặt hàng với mã tăng usedCount và lưu discount vào đơn', async () => {
      const product = await createProduct();
      await createCoupon({ code: 'FEATURES-ORDER', type: 'percent', value: 10, maxDiscount: 50_000 });

      const response = await createOrder({ productId: product.id, couponCode: 'features-order' });

      expect(response.status).toBe(201);
      expect(response.body.discount).toBe(50_000);
      expect(response.body.couponCode).toBe('FEATURES-ORDER');
      expect((await prisma.coupon.findUniqueOrThrow({ where: { code: 'FEATURES-ORDER' } })).usedCount).toBe(1);
    });

    it('admin tạo, sửa và xóa mã giảm giá', async () => {
      const created = await request(app)
        .post('/api/coupons')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: ' features-admin-crud ', type: 'fixed', value: 15_000 });

      expect(created.status).toBe(201);
      expect(created.body.code).toBe('FEATURES-ADMIN-CRUD');

      const updated = await request(app)
        .put(`/api/coupons/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: 20_000 });

      expect(updated.status).toBe(200);
      expect(updated.body.value).toBe(20_000);

      const deleted = await request(app)
        .delete(`/api/coupons/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(deleted.status).toBe(200);
      expect(await prisma.coupon.findUnique({ where: { id: created.body.id } })).toBeNull();
    });

    it('user thường gọi API admin của coupon bị 403', async () => {
      const response = await request(app)
        .get('/api/coupons')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(403);
    });
  });

  describe('Hoàn kho và lượt mã khi hủy đơn', () => {
    it('user hủy đơn có mã thì hoàn tồn kho và usedCount', async () => {
      const product = await createProduct(7);
      await createCoupon({ code: 'FEATURES-USER-CANCEL', type: 'fixed', value: 10_000 });
      const created = await createOrder({ productId: product.id, couponCode: 'FEATURES-USER-CANCEL' });
      expect(created.status).toBe(201);
      expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(6);
      expect((await prisma.coupon.findUniqueOrThrow({ where: { code: 'FEATURES-USER-CANCEL' } })).usedCount).toBe(1);

      const cancelled = await request(app)
        .post(`/api/orders/${created.body.id}/cancel`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(cancelled.status).toBe(200);
      expect(cancelled.body.status).toBe('cancelled');
      expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(7);
      expect((await prisma.coupon.findUniqueOrThrow({ where: { code: 'FEATURES-USER-CANCEL' } })).usedCount).toBe(0);
    });

    it('admin hủy đơn qua status thì hoàn tồn kho, lượt mã và giữ paymentStatus', async () => {
      const product = await createProduct(9);
      await createCoupon({ code: 'FEATURES-ADMIN-CANCEL', type: 'fixed', value: 10_000 });
      const created = await createOrder({
        productId: product.id,
        couponCode: 'FEATURES-ADMIN-CANCEL',
        paymentMethod: 'transfer',
      });
      expect(created.status).toBe(201);

      const paid = await request(app)
        .patch(`/api/orders/${created.body.id}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ paymentStatus: 'paid' });
      expect(paid.status).toBe(200);

      const cancelled = await request(app)
        .patch(`/api/orders/${created.body.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelled' });

      expect(cancelled.status).toBe(200);
      expect(cancelled.body.status).toBe('cancelled');
      expect(cancelled.body.paymentStatus).toBe('paid');
      expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(9);
      expect((await prisma.coupon.findUniqueOrThrow({ where: { code: 'FEATURES-ADMIN-CANCEL' } })).usedCount).toBe(0);
    });
  });

  describe('Danh sách yêu thích', () => {
    it('chưa đăng nhập không được truy cập wishlist', async () => {
      const response = await request(app).get('/api/wishlist');
      expect(response.status).toBe(401);
    });

    it('thêm, liệt kê và xóa sản phẩm yêu thích', async () => {
      const added = await request(app)
        .post(`/api/wishlist/${productId}`)
        .set('Authorization', `Bearer ${userToken}`);
      expect(added.status).toBe(200);

      const listed = await request(app)
        .get('/api/wishlist')
        .set('Authorization', `Bearer ${userToken}`);
      expect(listed.status).toBe(200);
      expect(listed.body.some((item: { id: string }) => item.id === productId)).toBe(true);

      const removed = await request(app)
        .delete(`/api/wishlist/${productId}`)
        .set('Authorization', `Bearer ${userToken}`);
      expect(removed.status).toBe(200);

      const afterRemoval = await request(app)
        .get('/api/wishlist')
        .set('Authorization', `Bearer ${userToken}`);
      expect(afterRemoval.body.some((item: { id: string }) => item.id === productId)).toBe(false);
    });

    it('thêm trùng sản phẩm vẫn thành công và chỉ có một bản ghi', async () => {
      const first = await request(app)
        .post(`/api/wishlist/${productId}`)
        .set('Authorization', `Bearer ${userToken}`);
      const second = await request(app)
        .post(`/api/wishlist/${productId}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(await prisma.wishlist.count({ where: { userId, productId } })).toBe(1);
    });

    it('sản phẩm không tồn tại không được thêm vào wishlist', async () => {
      const response = await request(app)
        .post('/api/wishlist/missing-product')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(404);
      expect(response.body.message).toMatch(/không tìm thấy sản phẩm/i);
    });
  });

  describe('Đánh giá sản phẩm', () => {
    it('chỉ người đã nhận hàng được đánh giá và cập nhật điểm sản phẩm', async () => {
      const product = await createProduct();

      const beforeDelivery = await request(app)
        .post(`/api/products/${product.id}/reviews`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ rating: 5, comment: 'Đánh giá trước khi nhận hàng' });
      expect(beforeDelivery.status).toBe(403);

      const order = await createOrder({ productId: product.id });
      expect(order.status).toBe(201);
      for (const status of ['processing', 'shipping', 'delivered']) {
        const updated = await request(app)
          .patch(`/api/orders/${order.body.id}/status`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ status });
        expect(updated.status).toBe(200);
      }

      const invalidRating = await request(app)
        .post(`/api/products/${product.id}/reviews`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ rating: 6, comment: 'Điểm ngoài phạm vi' });
      expect(invalidRating.status).toBe(400);

      const created = await request(app)
        .post(`/api/products/${product.id}/reviews`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ rating: 5, comment: 'Sản phẩm tốt' });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ productId: product.id, rating: 5, comment: 'Sản phẩm tốt' });

      const duplicate = await request(app)
        .post(`/api/products/${product.id}/reviews`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ rating: 4, comment: 'Đánh giá lần hai' });
      expect(duplicate.status).toBe(400);
      expect(duplicate.body.message).toMatch(/đã đánh giá/i);

      const updatedProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(updatedProduct.rating).toBe(5);
      expect(updatedProduct.reviewCount).toBe(1);

      const publicReviews = await request(app).get(`/api/products/${product.id}/reviews`);
      expect(publicReviews.status).toBe(200);
      expect(publicReviews.body.total).toBe(1);
      expect(publicReviews.body.items[0]).toMatchObject({
        id: created.body.id,
        userId,
        rating: 5,
        comment: 'Sản phẩm tốt',
      });
      expect(publicReviews.body.rating).toBe(5);
      expect(publicReviews.body.reviewCount).toBe(1);

      const forbiddenDelete = await request(app)
        .delete(`/api/reviews/${created.body.id}`)
        .set('Authorization', `Bearer ${userToken}`);
      expect(forbiddenDelete.status).toBe(403);
    });
  });

  describe('Quên và đặt lại mật khẩu', () => {
    it('đặt lại mật khẩu thành công, chỉ mật khẩu mới đăng nhập được và token không dùng lại được', async () => {
      vi.stubEnv('EXPOSE_RESET_TOKEN', 'true');
      try {
        const forgot = await request(app)
          .post('/api/auth/forgot-password')
          .send({ email: 'features-user@test.com' });
        expect(forgot.status).toBe(200);
        expect(forgot.body.resetToken).toBeTruthy();

        const reset = await request(app)
          .post('/api/auth/reset-password')
          .send({ token: forgot.body.resetToken, password: 'newpass123' });
        expect(reset.status).toBe(200);
        expect(reset.body.message).toMatch(/thành công/i);

        const newPasswordLogin = await request(app)
          .post('/api/auth/login')
          .send({ email: 'features-user@test.com', password: 'newpass123' });
        expect(newPasswordLogin.status).toBe(200);

        const oldPasswordLogin = await request(app)
          .post('/api/auth/login')
          .send({ email: 'features-user@test.com', password: 'test1234' });
        expect(oldPasswordLogin.status).toBe(401);

        const reusedToken = await request(app)
          .post('/api/auth/reset-password')
          .send({ token: forgot.body.resetToken, password: 'anotherpass123' });
        expect(reusedToken.status).toBe(400);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it('token hết hạn bị từ chối', async () => {
      vi.stubEnv('EXPOSE_RESET_TOKEN', 'true');
      try {
        const forgot = await request(app)
          .post('/api/auth/forgot-password')
          .send({ email: 'features-user@test.com' });
        expect(forgot.status).toBe(200);
        expect(forgot.body.resetToken).toBeTruthy();

        const record = await prisma.passwordReset.findFirstOrThrow({
          where: { userId },
          orderBy: { createdAt: 'desc' },
        });
        await prisma.passwordReset.update({
          where: { id: record.id },
          data: { expiresAt: new Date(Date.now() - 60_000) },
        });

        const reset = await request(app)
          .post('/api/auth/reset-password')
          .send({ token: forgot.body.resetToken, password: 'newpass456' });
        expect(reset.status).toBe(400);
        expect(reset.body.message).toMatch(/không hợp lệ hoặc đã hết hạn/i);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it('email không tồn tại nhận cùng thông báo chung và không nhận resetToken', async () => {
      vi.stubEnv('EXPOSE_RESET_TOKEN', 'true');
      try {
        const existingEmail = await request(app)
          .post('/api/auth/forgot-password')
          .send({ email: 'features-user@test.com' });
        const unknownEmail = await request(app)
          .post('/api/auth/forgot-password')
          .send({ email: 'missing-features@test.com' });

        expect(existingEmail.status).toBe(200);
        expect(unknownEmail.status).toBe(200);
        expect(unknownEmail.body.message).toBe(existingEmail.body.message);
        expect(unknownEmail.body.resetToken).toBeUndefined();
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});
