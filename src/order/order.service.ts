import { Injectable, Logger } from '@nestjs/common';
import { DatabaseUnavailableException } from '../common/application-error';
import type { RequestContext } from '../common/request-context';
import { PrismaService } from '../database/prisma.service';
import { OrderStatus as PrismaOrderStatus } from '../generated/prisma/enums';
import { Prisma, type Order as PersistedOrder, type Product } from '../generated/prisma/client';
import {
  ActiveOrderNotFoundError,
  CUSTOMER_NAME_MAX_LENGTH,
  CUSTOMER_NAME_MIN_LENGTH,
  CUSTOMER_PHONE_MAX_DIGITS,
  CUSTOMER_PHONE_MIN_DIGITS,
  CustomerDetailsRequiredError,
  CustomerNameValidationError,
  CustomerPhoneFormatError,
  CustomerPhoneLengthError,
  OrderCurrencyMismatchError,
  OrderError,
  OrderItemNotFoundError,
  OrderItemQuantityExceededError,
  OrderProductNotAvailableError,
} from './order.errors';
import { InvalidOrderTransitionError, OrderStateMachine } from './order-state-machine';
import {
  OrderAction,
  OrderStatus,
  type AddOrderItemInput,
  type OrderConfirmationResult,
  type MutateOrderItemsInput,
  type OrderResult,
  type RemoveOrderItemInput,
  type SetOrderCustomerDetailsInput,
} from './order.types';

const ACTIVE_ORDER_STATUSES = [
  PrismaOrderStatus.STARTED,
  PrismaOrderStatus.SELECTING_PRODUCTS,
  PrismaOrderStatus.COLLECTING_CUSTOMER_DATA,
  PrismaOrderStatus.CONFIRMING_ORDER,
] as const;

const DOMAIN_STATUS_BY_PERSISTENCE: Record<PrismaOrderStatus, OrderStatus> = {
  [PrismaOrderStatus.STARTED]: OrderStatus.STARTED,
  [PrismaOrderStatus.SELECTING_PRODUCTS]: OrderStatus.SELECTING_PRODUCTS,
  [PrismaOrderStatus.COLLECTING_CUSTOMER_DATA]: OrderStatus.COLLECTING_CUSTOMER_DATA,
  [PrismaOrderStatus.CONFIRMING_ORDER]: OrderStatus.CONFIRMING_ORDER,
  [PrismaOrderStatus.CONFIRMED]: OrderStatus.CONFIRMED,
  [PrismaOrderStatus.CANCELLED]: OrderStatus.CANCELLED,
  [PrismaOrderStatus.EXPIRED]: OrderStatus.EXPIRED,
};

const PERSISTENCE_STATUS_BY_DOMAIN: Record<OrderStatus, PrismaOrderStatus> = {
  [OrderStatus.STARTED]: PrismaOrderStatus.STARTED,
  [OrderStatus.SELECTING_PRODUCTS]: PrismaOrderStatus.SELECTING_PRODUCTS,
  [OrderStatus.COLLECTING_CUSTOMER_DATA]: PrismaOrderStatus.COLLECTING_CUSTOMER_DATA,
  [OrderStatus.CONFIRMING_ORDER]: PrismaOrderStatus.CONFIRMING_ORDER,
  [OrderStatus.CONFIRMED]: PrismaOrderStatus.CONFIRMED,
  [OrderStatus.CANCELLED]: PrismaOrderStatus.CANCELLED,
  [OrderStatus.EXPIRED]: PrismaOrderStatus.EXPIRED,
};

type TransactionClient = Prisma.TransactionClient;
type PersistedOrderItem = Awaited<ReturnType<TransactionClient['orderItem']['findMany']>>[number];

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stateMachine: OrderStateMachine,
  ) {}

  getActiveOrder(conversationId: string, context?: RequestContext): Promise<OrderResult | null> {
    return this.execute('order.active.read', context, async () => {
      const order = await this.prisma.order.findFirst({
        where: { conversationId, status: { in: [...ACTIVE_ORDER_STATUSES] } },
        include: { items: { orderBy: { createdAt: 'asc' } } },
        orderBy: { updatedAt: 'desc' },
      });

      return order ? this.toOrderResult(order, order.items) : null;
    });
  }

  getLatestOrder(conversationId: string, context?: RequestContext): Promise<OrderResult | null> {
    return this.execute('order.latest.read', context, async () => {
      const order = await this.prisma.order.findFirst({
        where: { conversationId },
        include: { items: { orderBy: { createdAt: 'asc' } } },
        orderBy: [{ createdAt: 'desc' }, { updatedAt: 'desc' }],
      });

      return order ? this.toOrderResult(order, order.items) : null;
    });
  }

  async addItem(input: AddOrderItemInput, context?: RequestContext): Promise<OrderResult> {
    return this.addItems(
      {
        conversationId: input.conversationId,
        items: [{ productId: input.productId, quantity: input.quantity }],
      },
      context,
    );
  }

  async addItems(input: MutateOrderItemsInput, context?: RequestContext): Promise<OrderResult> {
    const items = this.normalizeMutations(input.items);

    return this.executeAction('order.item.add', OrderAction.ADD_ITEMS, context, () =>
      this.prisma.$transaction(async (transaction) => {
        await this.lockConversation(transaction, input.conversationId);
        const products: Product[] = [];
        for (const item of items) {
          const product = await transaction.product.findFirst({
            where: { id: item.productId, active: true, availableForOrdering: true },
          });
          if (!product) {
            throw new OrderProductNotAvailableError(item.productId);
          }
          products.push(product);
        }
        const productsById = new Map(products.map((product) => [product.id, product]));

        const firstProduct = productsById.get(items[0]!.productId)!;
        let order = await this.findActiveOrder(transaction, input.conversationId);
        if (!order) {
          order = await transaction.order.create({
            data: {
              conversationId: input.conversationId,
              status: PrismaOrderStatus.STARTED,
              currency: firstProduct.currency,
            },
          });
        }
        if (products.some((product) => order.currency !== product.currency)) {
          throw new OrderCurrencyMismatchError();
        }

        for (const item of items) {
          const product = productsById.get(item.productId)!;
          const existingItem = await transaction.orderItem.findUnique({
            where: {
              orderId_productId: { orderId: order.id, productId: item.productId },
            },
          });

          if (existingItem) {
            const quantity = existingItem.quantity + item.quantity;
            await transaction.orderItem.update({
              where: { id: existingItem.id },
              data: {
                quantity,
                lineTotal: existingItem.unitPrice.mul(quantity),
              },
            });
          } else {
            await transaction.orderItem.create({
              data: {
                orderId: order.id,
                productId: product.id,
                productName: product.name,
                unitPrice: product.price,
                quantity: item.quantity,
                lineTotal: product.price.mul(item.quantity),
              },
            });
          }
        }

        return this.applyAction(transaction, order, OrderAction.ADD_ITEMS);
      }),
    );
  }

  async removeItem(input: RemoveOrderItemInput, context?: RequestContext): Promise<OrderResult> {
    return this.removeItems(
      {
        conversationId: input.conversationId,
        items: [{ productId: input.productId, quantity: input.quantity }],
      },
      context,
    );
  }

  async removeItems(input: MutateOrderItemsInput, context?: RequestContext): Promise<OrderResult> {
    const items = this.normalizeMutations(input.items);

    return this.executeAction('order.item.remove', OrderAction.REMOVE_ITEMS, context, () =>
      this.prisma.$transaction(async (transaction) => {
        await this.lockConversation(transaction, input.conversationId);
        const order = await this.requireActiveOrder(transaction, input.conversationId);
        const persistedItemsByProductId = new Map<string, PersistedOrderItem>();

        for (const requestedItem of items) {
          const persistedItem = await transaction.orderItem.findUnique({
            where: {
              orderId_productId: {
                orderId: order.id,
                productId: requestedItem.productId,
              },
            },
          });
          if (!persistedItem) {
            throw new OrderItemNotFoundError(requestedItem.productId);
          }
          if (requestedItem.quantity > persistedItem.quantity) {
            throw new OrderItemQuantityExceededError(
              requestedItem.productId,
              requestedItem.quantity,
              persistedItem.quantity,
            );
          }
          persistedItemsByProductId.set(requestedItem.productId, persistedItem);
        }

        for (const requestedItem of items) {
          const persistedItem = persistedItemsByProductId.get(requestedItem.productId)!;
          const quantity = persistedItem.quantity - requestedItem.quantity;
          if (quantity === 0) {
            await transaction.orderItem.delete({ where: { id: persistedItem.id } });
          } else {
            await transaction.orderItem.update({
              where: { id: persistedItem.id },
              data: { quantity, lineTotal: persistedItem.unitPrice.mul(quantity) },
            });
          }
        }

        return this.applyAction(transaction, order, OrderAction.REMOVE_ITEMS);
      }),
    );
  }

  review(conversationId: string, context?: RequestContext): Promise<OrderResult> {
    return this.applyStatusAction(conversationId, OrderAction.REVIEW, 'order.review', context);
  }

  setCustomerDetails(
    input: SetOrderCustomerDetailsInput,
    context?: RequestContext,
  ): Promise<OrderResult> {
    const details = this.normalizeCustomerDetails(input);

    return this.executeAction(
      'order.customer.update',
      OrderAction.SET_CUSTOMER_DETAILS,
      context,
      () =>
        this.prisma.$transaction(async (transaction) => {
          await this.lockConversation(transaction, input.conversationId);
          const order = await this.requireActiveOrder(transaction, input.conversationId);
          const updatedOrder = await transaction.order.update({
            where: { id: order.id },
            data: details,
          });
          return this.applyAction(transaction, updatedOrder, OrderAction.SET_CUSTOMER_DETAILS);
        }),
    );
  }

  confirm(conversationId: string, context?: RequestContext): Promise<OrderConfirmationResult> {
    return this.executeAction('order.confirm', OrderAction.CONFIRM, context, () =>
      this.prisma.$transaction(async (transaction) => {
        await this.lockConversation(transaction, conversationId);
        const activeOrder = await this.findActiveOrder(transaction, conversationId);

        if (activeOrder) {
          const confirmedOrder = await this.applyAction(
            transaction,
            activeOrder,
            OrderAction.CONFIRM,
          );
          return { ...confirmedOrder, idempotentReplay: false };
        }

        const confirmedOrder = await transaction.order.findFirst({
          where: { conversationId },
          orderBy: [{ createdAt: 'desc' }, { updatedAt: 'desc' }],
        });
        if (confirmedOrder?.status !== PrismaOrderStatus.CONFIRMED) {
          throw new ActiveOrderNotFoundError();
        }
        const items = await transaction.orderItem.findMany({
          where: { orderId: confirmedOrder.id },
          orderBy: { createdAt: 'asc' },
        });

        return {
          ...this.toOrderResult(confirmedOrder, items),
          idempotentReplay: true,
        };
      }),
    );
  }

  cancel(conversationId: string, context?: RequestContext): Promise<OrderResult> {
    return this.applyStatusAction(conversationId, OrderAction.CANCEL, 'order.cancel', context);
  }

  expire(conversationId: string, context?: RequestContext): Promise<OrderResult> {
    return this.applyStatusAction(conversationId, OrderAction.EXPIRE, 'order.expire', context);
  }

  private applyStatusAction(
    conversationId: string,
    action: OrderAction,
    operation: string,
    context?: RequestContext,
  ): Promise<OrderResult> {
    return this.executeAction(operation, action, context, () =>
      this.prisma.$transaction(async (transaction) => {
        await this.lockConversation(transaction, conversationId);
        const order = await this.requireActiveOrder(transaction, conversationId);
        return this.applyAction(transaction, order, action);
      }),
    );
  }

  private async applyAction(
    transaction: TransactionClient,
    order: PersistedOrder,
    action: OrderAction,
  ): Promise<OrderResult> {
    const items = await transaction.orderItem.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    });
    const itemCount = items.reduce((count, item) => count + item.quantity, 0);
    const total = items.reduce(
      (currentTotal, item) => currentTotal.add(item.lineTotal),
      new Prisma.Decimal(0),
    );
    const status = this.stateMachine.transition({
      status: DOMAIN_STATUS_BY_PERSISTENCE[order.status],
      action,
      itemCount,
      customerDetailsComplete: this.hasCompleteCustomerDetails(order),
    });
    if (action === OrderAction.CONFIRM) {
      await this.assertProductsAvailable(transaction, items);
    }
    const orderNumber =
      status === OrderStatus.CONFIRMED && order.orderNumber === null
        ? await this.nextOrderNumber(transaction)
        : order.orderNumber;
    const updatedOrder = await transaction.order.update({
      where: { id: order.id },
      data: {
        status: PERSISTENCE_STATUS_BY_DOMAIN[status],
        total,
        ...(status === OrderStatus.CONFIRMED ? { orderNumber } : {}),
      },
    });

    return this.toOrderResult(updatedOrder, items);
  }

  private async assertProductsAvailable(
    transaction: TransactionClient,
    items: PersistedOrderItem[],
  ): Promise<void> {
    const productIds = items.map((item) => item.productId);
    const availableProducts = await transaction.product.findMany({
      where: {
        id: { in: productIds },
        active: true,
        availableForOrdering: true,
      },
      select: { id: true },
    });
    const availableProductIds = new Set(availableProducts.map((product) => product.id));
    const unavailableItem = items.find((item) => !availableProductIds.has(item.productId));

    if (unavailableItem) {
      throw new OrderProductNotAvailableError(unavailableItem.productId);
    }
  }

  private findActiveOrder(
    transaction: TransactionClient,
    conversationId: string,
  ): Promise<PersistedOrder | null> {
    return transaction.order.findFirst({
      where: { conversationId, status: { in: [...ACTIVE_ORDER_STATUSES] } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  private async lockConversation(
    transaction: TransactionClient,
    conversationId: string,
  ): Promise<void> {
    await transaction.$queryRaw<Array<{ locked: number }>>`
      SELECT 1 AS "locked"
      FROM (
        SELECT pg_advisory_xact_lock(hashtextextended(${conversationId}, 0))
      ) AS "conversation_lock"
    `;
  }

  private async requireActiveOrder(
    transaction: TransactionClient,
    conversationId: string,
  ): Promise<PersistedOrder> {
    const order = await this.findActiveOrder(transaction, conversationId);
    if (!order) {
      throw new ActiveOrderNotFoundError();
    }
    return order;
  }

  private toOrderResult(order: PersistedOrder, items: PersistedOrderItem[]): OrderResult {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      conversationId: order.conversationId,
      status: DOMAIN_STATUS_BY_PERSISTENCE[order.status],
      total: order.total.toNumber(),
      currency: order.currency,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      items: items.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        unitPrice: item.unitPrice.toNumber(),
        quantity: item.quantity,
        lineTotal: item.lineTotal.toNumber(),
      })),
    };
  }

  private validateQuantity(quantity: number): void {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new RangeError('Order item quantity must be a positive integer');
    }
  }

  private normalizeCustomerDetails({ customerName, customerPhone }: SetOrderCustomerDetailsInput): {
    customerName?: string;
    customerPhone?: string;
  } {
    if (customerName === undefined && customerPhone === undefined) {
      throw new CustomerDetailsRequiredError();
    }

    const details: { customerName?: string; customerPhone?: string } = {};
    if (customerName !== undefined) {
      const normalizedName = customerName.trim().replace(/\s+/g, ' ');
      if (
        normalizedName.length < CUSTOMER_NAME_MIN_LENGTH ||
        normalizedName.length > CUSTOMER_NAME_MAX_LENGTH ||
        !/\p{L}/u.test(normalizedName)
      ) {
        throw new CustomerNameValidationError();
      }
      details.customerName = normalizedName;
    }
    if (customerPhone !== undefined) {
      const trimmedPhone = customerPhone.trim();
      if (!/^\+?[\d\s()-]+$/.test(trimmedPhone)) {
        throw new CustomerPhoneFormatError();
      }
      const hasInternationalPrefix = trimmedPhone.startsWith('+');
      const digits = trimmedPhone.replace(/\D/g, '');
      if (digits.length < CUSTOMER_PHONE_MIN_DIGITS || digits.length > CUSTOMER_PHONE_MAX_DIGITS) {
        throw new CustomerPhoneLengthError();
      }
      details.customerPhone = `${hasInternationalPrefix ? '+' : ''}${digits}`;
    }

    return details;
  }

  private hasCompleteCustomerDetails(order: PersistedOrder): boolean {
    return order.customerName !== null && order.customerPhone !== null;
  }

  private async nextOrderNumber(transaction: TransactionClient): Promise<number> {
    const [result] = await transaction.$queryRaw<Array<{ value: bigint }>>`
      SELECT nextval('order_number_seq') AS "value"
    `;
    if (!result) {
      throw new Error('PostgreSQL did not generate an order number');
    }
    return Number(result.value);
  }

  private normalizeMutations(
    items: MutateOrderItemsInput['items'],
  ): MutateOrderItemsInput['items'] {
    if (items.length === 0) {
      throw new RangeError('An order item operation requires at least one item');
    }

    const quantitiesByProductId = new Map<string, number>();
    for (const item of items) {
      this.validateQuantity(item.quantity);
      quantitiesByProductId.set(
        item.productId,
        (quantitiesByProductId.get(item.productId) ?? 0) + item.quantity,
      );
    }

    return [...quantitiesByProductId].map(([productId, quantity]) => ({ productId, quantity }));
  }

  private async executeAction<T extends OrderResult>(
    operation: string,
    action: OrderAction,
    context: RequestContext | undefined,
    execute: () => Promise<T>,
  ): Promise<T> {
    try {
      const result = await this.execute(operation, context, execute);
      this.logger.log({
        event: 'order.action.completed',
        ...context,
        orderId: result.id,
        orderNumber: result.orderNumber,
        conversationId: result.conversationId,
        action,
        status: result.status,
        total: result.total,
        currency: result.currency,
        ...('idempotentReplay' in result ? { idempotentReplay: result.idempotentReplay } : {}),
      });
      return result;
    } catch (error: unknown) {
      if (
        error instanceof OrderError ||
        error instanceof InvalidOrderTransitionError ||
        error instanceof RangeError
      ) {
        this.logger.warn({
          event: 'order.action.rejected',
          ...context,
          operation,
          action,
          failureCode: error.name,
          message: error.message,
        });
      }
      throw error;
    }
  }

  private async execute<T>(
    operation: string,
    context: RequestContext | undefined,
    execute: () => Promise<T>,
  ): Promise<T> {
    try {
      return await execute();
    } catch (error: unknown) {
      if (
        error instanceof OrderError ||
        error instanceof InvalidOrderTransitionError ||
        error instanceof RangeError
      ) {
        throw error;
      }

      const message = error instanceof Error ? error.message : 'Unknown PostgreSQL error';
      this.logger.error({
        event: 'database.operation.failed',
        ...context,
        operation,
        failureCode: 'DATABASE_UNAVAILABLE',
        message,
      });
      throw new DatabaseUnavailableException();
    }
  }
}
