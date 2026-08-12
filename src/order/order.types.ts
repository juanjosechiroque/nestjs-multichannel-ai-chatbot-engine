export enum OrderStatus {
  STARTED = 'STARTED',
  SELECTING_PRODUCTS = 'SELECTING_PRODUCTS',
  CONFIRMING_ORDER = 'CONFIRMING_ORDER',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export enum OrderAction {
  ADD_ITEMS = 'ADD_ITEMS',
  REMOVE_ITEMS = 'REMOVE_ITEMS',
  REVIEW = 'REVIEW',
  CONFIRM = 'CONFIRM',
  CANCEL = 'CANCEL',
  EXPIRE = 'EXPIRE',
}

export interface OrderTransitionInput {
  status: OrderStatus;
  action: OrderAction;
  /** Current item count, or the resulting count when adding or removing items. */
  itemCount: number;
}

export interface OrderItemResult {
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface OrderResult {
  id: string;
  conversationId: string;
  status: OrderStatus;
  total: number;
  currency: string;
  items: OrderItemResult[];
}

export interface AddOrderItemInput {
  conversationId: string;
  productId: string;
  quantity: number;
}

export type RemoveOrderItemInput = AddOrderItemInput;

export interface OrderItemMutation {
  productId: string;
  quantity: number;
}

export interface MutateOrderItemsInput {
  conversationId: string;
  items: OrderItemMutation[];
}
