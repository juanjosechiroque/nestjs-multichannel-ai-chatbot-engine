export abstract class OrderError extends Error {}

export class ActiveOrderNotFoundError extends OrderError {
  constructor() {
    super('No active order was found for this conversation');
    this.name = ActiveOrderNotFoundError.name;
  }
}

export class OrderProductNotAvailableError extends OrderError {
  constructor(readonly productId: string) {
    super(`Product ${productId} is not available`);
    this.name = OrderProductNotAvailableError.name;
  }
}

export class OrderItemNotFoundError extends OrderError {
  constructor(readonly productId: string) {
    super(`Product ${productId} is not part of the active order`);
    this.name = OrderItemNotFoundError.name;
  }
}

export class OrderItemQuantityExceededError extends OrderError {
  constructor(
    readonly productId: string,
    readonly requestedQuantity: number,
    readonly availableQuantity: number,
  ) {
    super(
      `Cannot remove ${requestedQuantity} units of product ${productId}; only ${availableQuantity} available`,
    );
    this.name = OrderItemQuantityExceededError.name;
  }
}

export class OrderCurrencyMismatchError extends OrderError {
  constructor() {
    super('All products in an order must use the same currency');
    this.name = OrderCurrencyMismatchError.name;
  }
}
