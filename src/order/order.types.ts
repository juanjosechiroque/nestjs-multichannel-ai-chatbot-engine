export enum OrderStatus {
  STARTED = 'STARTED',
  SELECTING_PRODUCTS = 'SELECTING_PRODUCTS',
  COLLECTING_CUSTOMER_DATA = 'COLLECTING_CUSTOMER_DATA',
  CONFIRMING_ORDER = 'CONFIRMING_ORDER',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export enum OrderAction {
  ADD_ITEMS = 'ADD_ITEMS',
  REMOVE_ITEMS = 'REMOVE_ITEMS',
  REVIEW = 'REVIEW',
  SET_CUSTOMER_DETAILS = 'SET_CUSTOMER_DETAILS',
  CONFIRM = 'CONFIRM',
  CANCEL = 'CANCEL',
  EXPIRE = 'EXPIRE',
}

export interface OrderTransitionInput {
  status: OrderStatus;
  action: OrderAction;
  /** Current item count, or the resulting count when adding or removing items. */
  itemCount: number;
  customerDetailsComplete?: boolean;
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
  orderNumber: number | null;
  conversationId: string;
  status: OrderStatus;
  total: number;
  currency: string;
  customerName: string | null;
  customerPhone: string | null;
  items: OrderItemResult[];
}

export interface OrderConfirmationResult extends OrderResult {
  /** True when CONFIRM returns an order that this conversation already confirmed. */
  idempotentReplay: boolean;
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

export interface SetOrderCustomerDetailsInput {
  conversationId: string;
  customerName?: string;
  customerPhone?: string;
}
