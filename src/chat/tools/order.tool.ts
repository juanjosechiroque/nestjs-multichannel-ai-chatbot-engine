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
import { OrderAction, OrderStatus, type OrderResult } from '../../order/order.types';

const ORDER_PRODUCT_CANDIDATE_LIMIT = 5;

export type CustomerOrderAction = Exclude<OrderAction, OrderAction.EXPIRE>;

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
  total: number;
  currency: string;
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
}

export interface OrderConversationContext {
  activeOrder: {
    order: CustomerOrderSnapshot;
    workflow: OrderWorkflowGuidance;
  } | null;
}

@Injectable()
export class OrderTool {
  constructor(
    @Inject(CatalogService)
    private readonly catalog: Pick<CatalogService, 'searchProducts'>,
    @Inject(OrderService)
    private readonly orders: Pick<
      OrderService,
      'addItems' | 'removeItems' | 'review' | 'confirm' | 'cancel' | 'getActiveOrder'
    >,
    private readonly stateMachine: OrderStateMachine,
  ) {}

  async getContext(
    conversationId: string,
    context: RequestContext,
  ): Promise<OrderConversationContext> {
    const activeOrder = await this.orders.getActiveOrder(conversationId, context);

    return {
      activeOrder: activeOrder
        ? {
            order: this.serializeOrder(activeOrder),
            workflow: this.getWorkflow(activeOrder),
          }
        : null,
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
          return this.success(action, await this.orders.confirm(conversationId, context));
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

  private success(action: CustomerOrderAction, order: OrderResult): string {
    return JSON.stringify({
      orderOperationStatus: 'completed',
      action,
      order: this.serializeOrder(order),
      workflow: this.getWorkflow(order),
      issues: [],
    });
  }

  private async rejected(
    action: CustomerOrderAction,
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
      total: order.total,
      currency: order.currency,
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
    const allowedActions = this.stateMachine
      .getAllowedActions(order.status, itemCount)
      .filter((action): action is CustomerOrderAction => action !== OrderAction.EXPIRE);
    const canConfirm = allowedActions.includes(OrderAction.CONFIRM);
    const nextAction =
      order.status === OrderStatus.SELECTING_PRODUCTS && itemCount > 0
        ? OrderAction.REVIEW
        : canConfirm
          ? OrderAction.CONFIRM
          : null;

    return { allowedActions, canConfirm, nextAction };
  }
}
