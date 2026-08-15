import { OrderAction, OrderStatus, type OrderTransitionInput } from './order.types';

const TERMINAL_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.CONFIRMED,
  OrderStatus.CANCELLED,
  OrderStatus.EXPIRED,
]);

export class InvalidOrderTransitionError extends Error {
  constructor(
    readonly status: OrderStatus,
    readonly action: OrderAction,
    reason?: string,
  ) {
    super(reason ?? `Cannot apply ${action} while order is ${status}`);
    this.name = InvalidOrderTransitionError.name;
  }
}

export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return TERMINAL_ORDER_STATUSES.has(status);
}

export class OrderStateMachine {
  getAllowedActions(
    status: OrderStatus,
    itemCount: number,
    customerDetailsComplete = false,
  ): OrderAction[] {
    this.validateItemCount(itemCount);

    if (isTerminalOrderStatus(status)) {
      return [];
    }

    const sharedActions = [OrderAction.CANCEL, OrderAction.EXPIRE];

    switch (status) {
      case OrderStatus.STARTED:
        return [OrderAction.ADD_ITEMS, ...sharedActions];
      case OrderStatus.SELECTING_PRODUCTS:
        return itemCount > 0
          ? [
              OrderAction.ADD_ITEMS,
              OrderAction.REMOVE_ITEMS,
              OrderAction.REVIEW,
              OrderAction.SET_CUSTOMER_DETAILS,
              ...sharedActions,
            ]
          : [OrderAction.ADD_ITEMS, ...sharedActions];
      case OrderStatus.COLLECTING_CUSTOMER_DATA:
        return itemCount > 0
          ? [
              OrderAction.ADD_ITEMS,
              OrderAction.REMOVE_ITEMS,
              OrderAction.SET_CUSTOMER_DETAILS,
              ...sharedActions,
            ]
          : [OrderAction.ADD_ITEMS, ...sharedActions];
      case OrderStatus.CONFIRMING_ORDER:
        return itemCount > 0 && customerDetailsComplete
          ? [
              OrderAction.ADD_ITEMS,
              OrderAction.REMOVE_ITEMS,
              OrderAction.SET_CUSTOMER_DETAILS,
              OrderAction.CONFIRM,
              ...sharedActions,
            ]
          : [OrderAction.ADD_ITEMS, ...sharedActions];
    }

    throw new RangeError(`Unknown order status: ${String(status)}`);
  }

  transition({
    status,
    action,
    itemCount,
    customerDetailsComplete = false,
  }: OrderTransitionInput): OrderStatus {
    this.validateItemCount(itemCount);

    if (isTerminalOrderStatus(status)) {
      throw new InvalidOrderTransitionError(status, action);
    }

    if (action === OrderAction.CANCEL) {
      return OrderStatus.CANCELLED;
    }

    if (action === OrderAction.EXPIRE) {
      return OrderStatus.EXPIRED;
    }

    switch (action) {
      case OrderAction.ADD_ITEMS:
        this.requireItems(status, action, itemCount);
        return OrderStatus.SELECTING_PRODUCTS;

      case OrderAction.REMOVE_ITEMS:
        if (status === OrderStatus.STARTED) {
          throw new InvalidOrderTransitionError(status, action);
        }
        return itemCount === 0 ? OrderStatus.STARTED : OrderStatus.SELECTING_PRODUCTS;

      case OrderAction.REVIEW:
        if (status !== OrderStatus.SELECTING_PRODUCTS) {
          throw new InvalidOrderTransitionError(status, action);
        }
        this.requireItems(status, action, itemCount);
        return customerDetailsComplete
          ? OrderStatus.CONFIRMING_ORDER
          : OrderStatus.COLLECTING_CUSTOMER_DATA;

      case OrderAction.SET_CUSTOMER_DETAILS:
        if (
          status !== OrderStatus.SELECTING_PRODUCTS &&
          status !== OrderStatus.COLLECTING_CUSTOMER_DATA &&
          status !== OrderStatus.CONFIRMING_ORDER
        ) {
          throw new InvalidOrderTransitionError(status, action);
        }
        this.requireItems(status, action, itemCount);
        if (status === OrderStatus.SELECTING_PRODUCTS) {
          return OrderStatus.SELECTING_PRODUCTS;
        }
        return customerDetailsComplete
          ? OrderStatus.CONFIRMING_ORDER
          : OrderStatus.COLLECTING_CUSTOMER_DATA;

      case OrderAction.CONFIRM:
        if (status !== OrderStatus.CONFIRMING_ORDER) {
          throw new InvalidOrderTransitionError(status, action);
        }
        this.requireItems(status, action, itemCount);
        if (!customerDetailsComplete) {
          throw new InvalidOrderTransitionError(
            status,
            action,
            'Cannot confirm an order without customer name and phone',
          );
        }
        return OrderStatus.CONFIRMED;
    }
  }

  private validateItemCount(itemCount: number): void {
    if (!Number.isInteger(itemCount) || itemCount < 0) {
      throw new RangeError('Order item count must be a non-negative integer');
    }
  }

  private requireItems(status: OrderStatus, action: OrderAction, itemCount: number): void {
    if (itemCount === 0) {
      throw new InvalidOrderTransitionError(
        status,
        action,
        `Cannot apply ${action} to an order without items`,
      );
    }
  }
}
