import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import { prisma } from '../prisma.js';

describe('TechStore API', () => {
  let adminToken = '';
  let userToken = '';
  let productId = '';

  beforeAll(async () => {
    await prisma.orderStatusLog.deleteMany();
    await prisma.review.deleteMany();
    await prisma.order.deleteMany();
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    await prisma.coupon.deleteMany();
    await prisma.user.deleteMany();

    const passwordHash = await bcrypt.hash('test1234', 10);
    const admin = await prisma.user.create({
      data: { email: 'admin@test.com', password: passwordHash, fullName: 'Admin Test', role: 'ADMIN', isActive: true },
    });
    const user = await prisma.user.create({
      data: { email: 'user@test.com', password: passwordHash, fullName: 'User Test', role: 'USER', isActive: true },
    });
    await prisma.user.create({
      data: { email: 'locked@test.com', password: passwordHash, fullName: 'Locked User', role: 'USER', isActive: false },
    });

    const category = await prisma.category.create({ data: { name: 'Test Cat', slug: 'test-cat', description: '' } });
    const product = await prisma.product.create({
      data: {
        name: 'Test Phone', slug: 'test-phone', categoryId: category.id, brand: 'Test', price: 1_000_000,
        salePrice: 900_000, stock: 2, status: 'active',
        images: JSON.stringify(['/images/products/placeholder.jpg']), specs: JSON.stringify({}),
      },
    });
    productId = product.id;

    const adminLogin = await request(app).post('/api/auth/login').send({ email: 'admin@test.com', password: 'test1234' });
    adminToken = adminLogin.body.token;
    const userLogin = await request(app).post('/api/auth/login').send({ email: 'user@test.com', password: 'test1234' });
    userToken = userLogin.body.token;

    expect(admin.id).toBeTruthy();
    expect(user.id).toBeTruthy();
    expect(adminToken).toBeTruthy();
    expect(userToken).toBeTruthy();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('đăng ký thành công', async () => {
    const response = await request(app).post('/api/auth/register').send({
      email: 'newuser@test.com', password: 'test1234', fullName: 'New User',
    });
    expect(response.status).toBe(201);
    expect(response.body.token).toBeTruthy();
    expect(response.body.user.email).toBe('newuser@test.com');
  });

  it('đăng nhập thành công', async () => {
    const response = await request(app).post('/api/auth/login').send({ email: 'user@test.com', password: 'test1234' });
    expect(response.status).toBe(200);
    expect(response.body.token).toBeTruthy();
  });

  it('register thiếu fullName trả 400', async () => {
    const response = await request(app).post('/api/auth/register').send({
      email: 'novalid@test.com', password: 'test1234',
    });
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/họ tên|fullName|không được để trống/i);
  });

  it('register mật khẩu ngắn trả 400', async () => {
    const response = await request(app).post('/api/auth/register').send({
      email: 'shortpw@test.com', password: '123', fullName: 'Short',
    });
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/mật khẩu.*6/i);
  });

  it('login email không hợp lệ trả 400', async () => {
    const response = await request(app).post('/api/auth/login').send({
      email: 'khong-phai-email', password: 'test1234',
    });
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/email/i);
  });

  it('admin tạo sản phẩm với salePrice null và giá trị mặc định', async () => {
    const category = await prisma.category.findFirstOrThrow();
    const response = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Sản phẩm kiểm thử',
        categoryId: category.id,
        price: 100_000,
        salePrice: null,
        stock: 0,
      });

    expect(response.status).toBe(201);
    expect(response.body.salePrice).toBeNull();
    expect(response.body.specs).toEqual({ 'Bảo hành': '12 tháng' });
    expect(response.body.images).toEqual(['/images/products/placeholder.jpg']);
  });

  it('API sản phẩm từ chối dữ liệu không hợp lệ và danh mục không tồn tại', async () => {
    const category = await prisma.category.findFirstOrThrow();
    const invalidProduct = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: ' ',
        categoryId: category.id,
        price: 100_000,
        salePrice: 100_000,
        stock: 0,
      });
    expect(invalidProduct.status).toBe(400);

    const missingCategory = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Sản phẩm kiểm thử',
        categoryId: 'missing-category',
        price: 100_000,
        salePrice: null,
        stock: 0,
      });
    expect(missingCategory.status).toBe(400);
    expect(missingCategory.body.message).toMatch(/danh mục không tồn tại/i);
  });

  it('admin cập nhật sản phẩm với salePrice null và từ chối giá khuyến mãi không hợp lệ', async () => {
    const clearSalePrice = await request(app)
      .put(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ salePrice: null });
    expect(clearSalePrice.status).toBe(200);
    expect(clearSalePrice.body.salePrice).toBeNull();

    const invalidPrice = await request(app)
      .put(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ price: 800_000, salePrice: 900_000 });
    expect(invalidPrice.status).toBe(400);
  });

  it('API danh mục validate dữ liệu và hỗ trợ cập nhật từng phần', async () => {
    const invalidName = await request(app)
      .post('/api/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '   ' });
    expect(invalidName.status).toBe(400);

    const invalidDescription = await request(app)
      .post('/api/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Danh mục kiểm thử', description: 'x'.repeat(501) });
    expect(invalidDescription.status).toBe(400);

    const created = await request(app)
      .post('/api/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '  Danh mục kiểm thử  ' });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Danh mục kiểm thử');
    expect(created.body.description).toBe('');

    const invalidUpdate = await request(app)
      .put(`/api/categories/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: ' ' });
    expect(invalidUpdate.status).toBe(400);

    const partialUpdate = await request(app)
      .put(`/api/categories/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ description: 'Mô tả mới' });
    expect(partialUpdate.status).toBe(200);
    expect(partialUpdate.body.name).toBe('Danh mục kiểm thử');
    expect(partialUpdate.body.description).toBe('Mô tả mới');
  });

  it('không xóa danh mục còn sản phẩm và xóa được danh mục rỗng', async () => {
    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    const category = await prisma.category.findUniqueOrThrow({ where: { id: product.categoryId } });
    const productCount = await prisma.product.count({ where: { categoryId: category.id } });
    const blockedDelete = await request(app)
      .delete(`/api/categories/${category.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(blockedDelete.status).toBe(400);
    expect(blockedDelete.body.message).toContain(`còn ${productCount} sản phẩm`);
    expect(await prisma.product.findUnique({ where: { id: productId } })).not.toBeNull();

    const emptyCategory = await prisma.category.create({
      data: { name: 'Empty category', slug: `empty-${Date.now()}` },
    });
    const deleted = await request(app)
      .delete(`/api/categories/${emptyCategory.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(deleted.status).toBe(200);
    expect(await prisma.category.findUnique({ where: { id: emptyCategory.id } })).toBeNull();
  });

  it('forgot-password thiếu email trả 400', async () => {
    const response = await request(app).post('/api/auth/forgot-password').send({});
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/email/i);
  });

  it('reset-password mật khẩu ngắn trả 400', async () => {
    const response = await request(app).post('/api/auth/reset-password').send({
      token: 'any-token', password: '123',
    });
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/mật khẩu.*6/i);
  });

  it('profile fullName rỗng trả 400', async () => {
    const response = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ fullName: '' });
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/họ tên|không được để trống/i);
  });

  it('tài khoản bị khóa không đăng nhập được', async () => {
    const response = await request(app).post('/api/auth/login').send({ email: 'locked@test.com', password: 'test1234' });
    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/khóa/i);
  });

  it('đặt hàng thành công và trừ kho', async () => {
    const before = await prisma.product.findUnique({ where: { id: productId } });
    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        items: [{ productId, quantity: 1 }], paymentMethod: 'cod',
        shippingInfo: {
          fullName: 'User Test', phone: '0900000000', email: 'user@test.com',
          address: '1 Test', city: 'HN', district: 'HK',
        },
      });
    expect(response.status).toBe(201);
    expect(response.body.total).toBeGreaterThan(0);
    expect(response.body.statusLogs).toHaveLength(1);
    const after = await prisma.product.findUnique({ where: { id: productId } });
    expect(after!.stock).toBe((before?.stock ?? 0) - 1);
  });

  it('đặt hàng vượt tồn kho bị từ chối', async () => {
    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        items: [{ productId, quantity: 99 }], paymentMethod: 'cod',
        shippingInfo: {
          fullName: 'User Test', phone: '0900000000', email: 'user@test.com',
          address: '1 Test', city: 'HN', district: 'HK',
        },
      });
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/kho|tồn/i);
  });

  it('user thường gọi API admin bị 403', async () => {
    const response = await request(app).get('/api/users').set('Authorization', `Bearer ${userToken}`);
    expect(response.status).toBe(403);
  });
});
