import { api } from './api';
import type { Review, ReviewListResponse } from '../types';

export const reviewService = {
  list(productId: string, page = 1, limit = 10) {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    return api<ReviewListResponse>(`/products/${productId}/reviews?${params}`);
  },

  create(productId: string, data: { rating: number; comment: string }) {
    return api<Review>(`/products/${productId}/reviews`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  remove(id: string) {
    return api<{ message: string }>(`/reviews/${id}`, { method: 'DELETE' });
  },
};
