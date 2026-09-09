export abstract class OrderError extends Error {}

export const CUSTOMER_NAME_MIN_LENGTH = 2;
export const CUSTOMER_NAME_MAX_LENGTH = 100;
export const CUSTOMER_PHONE_MIN_DIGITS = 8;
export const CUSTOMER_PHONE_MAX_DIGITS = 15;

export class CustomerDetailsRequiredError extends RangeError {
  constructor() {
    super('At least one customer detail is required');
    this.name = CustomerDetailsRequiredError.name;
  }
}

export class CustomerNameValidationError extends RangeError {
  readonly minimumCharacters = CUSTOMER_NAME_MIN_LENGTH;
  readonly maximumCharacters = CUSTOMER_NAME_MAX_LENGTH;

  constructor() {
    super(
      `Customer name must contain between ${CUSTOMER_NAME_MIN_LENGTH} and ${CUSTOMER_NAME_MAX_LENGTH} characters`,
    );
    this.name = CustomerNameValidationError.name;
  }
}

export class CustomerPhoneFormatError extends RangeError {
  constructor() {
    super('Customer phone contains unsupported characters');
    this.name = CustomerPhoneFormatError.name;
  }
}

export class CustomerPhoneLengthError extends RangeError {
  readonly minimumDigits = CUSTOMER_PHONE_MIN_DIGITS;
  readonly maximumDigits = CUSTOMER_PHONE_MAX_DIGITS;

  constructor() {
    super(
      `Customer phone must contain between ${CUSTOMER_PHONE_MIN_DIGITS} and ${CUSTOMER_PHONE_MAX_DIGITS} digits`,
    );
    this.name = CustomerPhoneLengthError.name;
  }
}

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
