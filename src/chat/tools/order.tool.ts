import { Inject, Injectable } from '@nestjs/common';
import { CatalogService } from '../../catalog/catalog.service';
import { ApplicationServiceUnavailableException } from '../../common/application-error';
import type { RequestContext } from '../../common/request-context';
import {
  ActiveOrderNotFoundError,
  OrderCurrencyMismatchError,
  OrderError,
  OrderItemNotFoundError,
  OrderItemQuantityExceededError,
  OrderProductNotAvailableError,
} from '../../order/order.errors';
import { InvalidOrderTransitionError, OrderStateMachine } from '../../order/order-state-machine';
import { OrderService } from '../../order/order.service';
import {
  OrderAction,
  OrderStatus,
  type OrderConfirmationResult,
  type OrderResult,
} from '../../order/order.types';

const ORDER_PRODUCT_CANDIDATE_LIMIT = 5;
const ACTIVE_ORDER_STATUSES = new Set([
  OrderStatus.STARTED,
  OrderStatus.SELECTING_PRODUCTS,
  OrderStatus.COLLECTING_CUSTOMER_DATA,
  OrderStatus.CONFIRMING_ORDER,
]);

export type CustomerOrderAction = Exclude<
  OrderAction,
  OrderAction.EXPIRE | OrderAction.SET_CUSTOMER_DETAILS
>;

export interface OrderCustomerDetailsArguments {
  customerName: string | null;
  customerPhone: string | null;
}

export interface OrderToolItemArgument {
  productName: string;
  quantity: number;
}

export interface OrderToolArguments {
  action: CustomerOrderAction;
  items: OrderToolItemArgument[];
}

export interface OrderToolInput extends OrderToolArguments {
  conversationId: string;
  context: RequestContext;
}

interface ProductReference {
  id: string;
  slug: string;
  name: string;
}

interface ResolutionIssue {
  productName: string;
  reason: 'not_found' | 'ambiguous';
  candidates: string[];
}

export interface CustomerOrderSnapshot {
  orderNumber: number | null;
  total: number;
  currency: string;
  customer: {
    name: string | null;
    maskedPhone: string | null;
  };
  items: Array<{
    productName: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }>;
}

export interface OrderWorkflowGuidance {
  allowedActions: CustomerOrderAction[];
  canConfirm: boolean;
  nextAction: CustomerOrderAction | null;
  missingCustomerFields: Array<'customerName' | 'customerPhone'>;
}

export interface OrderConversationContext {
  activeOrder: {
    order: CustomerOrderSnapshot;
    workflow: OrderWorkflowGuidance;
  } | null;
  confirmationReplayAvailable: boolean;
}

@Injectable()
export class OrderTool {
  constructor(
    @Inject(CatalogService)
    private readonly catalog: Pick<CatalogService, 'searchProducts'>,
    @Inject(OrderService)
    private readonly orders: Pick<
      OrderService,
      | 'addItems'
      | 'removeItems'
      | 'review'
      | 'confirm'
      | 'cancel'
      | 'getActiveOrder'
      | 'getLatestOrder'
      | 'setCustomerDetails'
    >,
    private readonly stateMachine: OrderStateMachine,
  ) {}

  async getContext(
    conversationId: string,
    context: RequestContext,
  ): Promise<OrderConversationContext> {
    const latestOrder = await this.orders.getLatestOrder(conversationId, context);
    const activeOrder =
      latestOrder && ACTIVE_ORDER_STATUSES.has(latestOrder.status) ? latestOrder : null;

    return {
      activeOrder: activeOrder
        ? {
            order: this.serializeOrder(activeOrder),
            workflow: this.getWorkflow(activeOrder),
          }
        : null,
      confirmationReplayAvailable: latestOrder?.status === OrderStatus.CONFIRMED,
    };
  }

  async execute({ action, items, conversationId, context }: OrderToolInput): Promise<string> {
    try {
      switch (action) {
        case OrderAction.ADD_ITEMS:
          return await this.addItems(items, conversationId, context);
        case OrderAction.REMOVE_ITEMS:
          return await this.removeItems(items, conversationId, context);
        case OrderAction.REVIEW:
          return this.success(action, await this.orders.review(conversationId, context));
        case OrderAction.CONFIRM:
          return await this.confirm(conversationId, context);
        case OrderAction.CANCEL:
          return this.success(action, await this.orders.cancel(conversationId, context));
      }
    } catch (error: unknown) {
      if (error instanceof ApplicationServiceUnavailableException) {
        throw error;
      }

      return this.rejected(action, error, conversationId, context);
    }
  }

  async setCustomerDetails(
    details: OrderCustomerDetailsArguments,
    conversationId: string,
    context: RequestContext,
  ): Promise<string> {
    try {
      const order = await this.orders.setCustomerDetails(
        {
          conversationId,
          ...(details.customerName === null ? {} : { customerName: details.customerName }),
          ...(details.customerPhone === null ? {} : { customerPhone: details.customerPhone }),
        },
        context,
      );
      return this.success(OrderAction.SET_CUSTOMER_DETAILS, order);
    } catch (error: unknown) {
      if (error instanceof ApplicationServiceUnavailableException) {
        throw error;
      }
      return this.rejected(OrderAction.SET_CUSTOMER_DETAILS, error, conversationId, context);
    }
  }

  private async confirm(conversationId: string, context: RequestContext): Promise<string> {
    const result = await this.orders.confirm(conversationId, context);
    return this.success(OrderAction.CONFIRM, result, {
      idempotentReplay: result.idempotentReplay,
    });
  }

  private async addItems(
    items: OrderToolItemArgument[],
    conversationId: string,
    context: RequestContext,
  ): Promise<string> {
    const resolutions = await Promise.all(
      items.map((item) => this.resolveCatalogProduct(item.productName, context)),
    );
    const issues = resolutions.flatMap((resolution) =>
      'issue' in resolution ? [resolution.issue] : [],
    );

    if (issues.length > 0) {
      return JSON.stringify({
        orderOperationStatus: 'clarification_required',
        action: OrderAction.ADD_ITEMS,
        order: null,
        issues,
      });
    }

    const resolvedItems = resolutions.map((resolution, index) => ({
      productId: (resolution as { product: ProductReference }).product.id,
      quantity: items[index]!.quantity,
    }));
    const order = await this.orders.addItems({ conversationId, items: resolvedItems }, context);
    return this.success(OrderAction.ADD_ITEMS, order);
  }

  private async removeItems(
    items: OrderToolItemArgument[],
    conversationId: string,
    context: RequestContext,
  ): Promise<string> {
    const activeOrder = await this.orders.getActiveOrder(conversationId, context);
    if (!activeOrder) {
      throw new ActiveOrderNotFoundError();
    }

    const resolutions = items.map((item) =>
      this.resolveOrderItem(item.productName, activeOrder.items),
    );
    const issues = resolutions.flatMap((resolution) =>
      'issue' in resolution ? [resolution.issue] : [],
    );

    if (issues.length > 0) {
      return JSON.stringify({
        orderOperationStatus: 'clarification_required',
        action: OrderAction.REMOVE_ITEMS,
        order: this.serializeOrder(activeOrder),
        workflow: this.getWorkflow(activeOrder),
        issues,
      });
    }

    const resolvedItems = resolutions.map((resolution, index) => ({
      productId: (resolution as { product: ProductReference }).product.id,
      quantity: items[index]!.quantity,
    }));
    const order = await this.orders.removeItems({ conversationId, items: resolvedItems }, context);
    return this.success(OrderAction.REMOVE_ITEMS, order);
  }

  private async resolveCatalogProduct(
    productName: string,
    context: RequestContext,
  ): Promise<{ product: ProductReference } | { issue: ResolutionIssue }> {
    const products = await this.catalog.searchProducts(
      { productName, limit: ORDER_PRODUCT_CANDIDATE_LIMIT },
      context,
    );
    return this.selectProduct(productName, products);
  }

  private resolveOrderItem(
    productName: string,
    items: OrderResult['items'],
  ): { product: ProductReference } | { issue: ResolutionIssue } {
    const normalizedQuery = this.normalize(productName);
    const candidates = items
      .filter((item) => this.normalize(item.productName).includes(normalizedQuery))
      .map((item) => ({ id: item.productId, slug: '', name: item.productName }));
    return this.selectProduct(productName, candidates);
  }

  private selectProduct(
    productName: string,
    products: ProductReference[],
  ): { product: ProductReference } | { issue: ResolutionIssue } {
    if (products.length === 0) {
      return {
        issue: { productName, reason: 'not_found', candidates: [] },
      };
    }

    const normalizedQuery = this.normalize(productName);
    const exactMatches = products.filter(
      (product) =>
        this.normalize(product.name) === normalizedQuery ||
        this.normalize(product.slug) === normalizedQuery,
    );
    const selected =
      exactMatches.length === 1 ? exactMatches[0] : products.length === 1 ? products[0] : undefined;

    return selected
      ? { product: selected }
      : {
          issue: {
            productName,
            reason: 'ambiguous',
            candidates: products.map((product) => product.name),
          },
        };
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private success(
    action: CustomerOrderAction | OrderAction.SET_CUSTOMER_DETAILS,
    order: OrderResult,
    metadata: Pick<OrderConfirmationResult, 'idempotentReplay'> | null = null,
  ): string {
    return JSON.stringify({
      orderOperationStatus: 'completed',
      action,
      ...(metadata ?? {}),
      order: this.serializeOrder(order),
      workflow: this.getWorkflow(order),
      issues: [],
    });
  }

  private async rejected(
    action: CustomerOrderAction | OrderAction.SET_CUSTOMER_DETAILS,
    error: unknown,
    conversationId: string,
    context: RequestContext,
  ): Promise<string> {
    let reason = 'invalid_order_operation';

    if (error instanceof ActiveOrderNotFoundError) reason = 'no_active_order';
    else if (error instanceof OrderProductNotAvailableError) reason = 'product_not_available';
    else if (error instanceof OrderItemNotFoundError) reason = 'item_not_in_order';
    else if (error instanceof OrderItemQuantityExceededError) reason = 'quantity_exceeds_order';
    else if (error instanceof OrderCurrencyMismatchError) reason = 'currency_mismatch';
    else if (error instanceof InvalidOrderTransitionError) reason = 'invalid_transition';
    else if (!(error instanceof OrderError) && !(error instanceof RangeError)) throw error;

    const activeOrder =
      reason === 'invalid_transition'
        ? await this.orders.getActiveOrder(conversationId, context)
        : null;

    return JSON.stringify({
      orderOperationStatus: 'rejected',
      action,
      order: activeOrder ? this.serializeOrder(activeOrder) : null,
      workflow: activeOrder ? this.getWorkflow(activeOrder) : null,
      issues: [{ reason }],
    });
  }

  private serializeOrder(order: OrderResult): CustomerOrderSnapshot {
    return {
      orderNumber: order.orderNumber,
      total: order.total,
      currency: order.currency,
      customer: {
        name: order.customerName,
        maskedPhone: this.maskPhone(order.customerPhone),
      },
      items: order.items.map((item) => ({
        productName: item.productName,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        lineTotal: item.lineTotal,
      })),
    };
  }

  private getWorkflow(order: OrderResult): OrderWorkflowGuidance {
    const itemCount = order.items.reduce((total, item) => total + item.quantity, 0);
    const customerDetailsComplete = order.customerName !== null && order.customerPhone !== null;
    const allowedActions = this.stateMachine
      .getAllowedActions(order.status, itemCount, customerDetailsComplete)
      .filter(
        (action): action is CustomerOrderAction =>
          action !== OrderAction.EXPIRE && action !== OrderAction.SET_CUSTOMER_DETAILS,
      );
    const canConfirm = allowedActions.includes(OrderAction.CONFIRM);
    const nextAction =
      order.status === OrderStatus.SELECTING_PRODUCTS && itemCount > 0
        ? OrderAction.REVIEW
        : canConfirm
          ? OrderAction.CONFIRM
          : null;

    const missingCustomerFields: OrderWorkflowGuidance['missingCustomerFields'] = [];
    if (order.customerName === null) missingCustomerFields.push('customerName');
    if (order.customerPhone === null) missingCustomerFields.push('customerPhone');

    return { allowedActions, canConfirm, nextAction, missingCustomerFields };
  }

  private maskPhone(phone: string | null): string | null {
    if (phone === null) return null;
    const visibleDigits = phone.slice(-3);
    return `${'*'.repeat(Math.max(0, phone.length - visibleDigits.length))}${visibleDigits}`;
  }
}
