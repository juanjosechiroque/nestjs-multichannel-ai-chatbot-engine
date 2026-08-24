import { OrderStatus as PrismaOrderStatus } from '../generated/prisma/enums';
import { OrderStatus } from './order.types';

describe('order persistence contract', () => {
  it('keeps the domain and database order statuses aligned', () => {
    expect(Object.values(PrismaOrderStatus)).toEqual(Object.values(OrderStatus));
  });
});
