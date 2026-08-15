import {
  InvalidOrderTransitionError,
  isTerminalOrderStatus,
  OrderStateMachine,
} from './order-state-machine';
import { OrderAction, OrderStatus } from './order.types';

describe('OrderStateMachine', () => {
  const stateMachine = new OrderStateMachine();

  describe('given a valid active order transition', () => {
    it.each([
      {
        status: OrderStatus.STARTED,
        action: OrderAction.ADD_ITEMS,
        itemCount: 1,
        expectedStatus: OrderStatus.SELECTING_PRODUCTS,
      },
      {
        status: OrderStatus.SELECTING_PRODUCTS,
        action: OrderAction.ADD_ITEMS,
        itemCount: 3,
        expectedStatus: OrderStatus.SELECTING_PRODUCTS,
      },
      {
        status: OrderStatus.SELECTING_PRODUCTS,
        action: OrderAction.REMOVE_ITEMS,
        itemCount: 1,
        expectedStatus: OrderStatus.SELECTING_PRODUCTS,
      },
      {
        status: OrderStatus.SELECTING_PRODUCTS,
        action: OrderAction.REMOVE_ITEMS,
        itemCount: 0,
        expectedStatus: OrderStatus.STARTED,
      },
      {
        status: OrderStatus.SELECTING_PRODUCTS,
        action: OrderAction.REVIEW,
        itemCount: 2,
        customerDetailsComplete: false,
        expectedStatus: OrderStatus.COLLECTING_CUSTOMER_DATA,
      },
      {
        status: OrderStatus.SELECTING_PRODUCTS,
        action: OrderAction.REVIEW,
        itemCount: 2,
        customerDetailsComplete: true,
        expectedStatus: OrderStatus.CONFIRMING_ORDER,
      },
      {
        status: OrderStatus.COLLECTING_CUSTOMER_DATA,
        action: OrderAction.SET_CUSTOMER_DETAILS,
        itemCount: 2,
        customerDetailsComplete: false,
        expectedStatus: OrderStatus.COLLECTING_CUSTOMER_DATA,
      },
      {
        status: OrderStatus.COLLECTING_CUSTOMER_DATA,
        action: OrderAction.SET_CUSTOMER_DETAILS,
        itemCount: 2,
        customerDetailsComplete: true,
        expectedStatus: OrderStatus.CONFIRMING_ORDER,
      },
      {
        status: OrderStatus.CONFIRMING_ORDER,
        action: OrderAction.ADD_ITEMS,
        itemCount: 3,
        expectedStatus: OrderStatus.SELECTING_PRODUCTS,
      },
      {
        status: OrderStatus.CONFIRMING_ORDER,
        action: OrderAction.REMOVE_ITEMS,
        itemCount: 1,
        expectedStatus: OrderStatus.SELECTING_PRODUCTS,
      },
      {
        status: OrderStatus.CONFIRMING_ORDER,
        action: OrderAction.REMOVE_ITEMS,
        itemCount: 0,
        expectedStatus: OrderStatus.STARTED,
      },
      {
        status: OrderStatus.CONFIRMING_ORDER,
        action: OrderAction.CONFIRM,
        itemCount: 2,
        customerDetailsComplete: true,
        expectedStatus: OrderStatus.CONFIRMED,
      },
    ])(
      'moves $status to $expectedStatus when receiving $action',
      ({ status, action, itemCount, customerDetailsComplete, expectedStatus }) => {
        expect(
          stateMachine.transition({ status, action, itemCount, customerDetailsComplete }),
        ).toBe(expectedStatus);
      },
    );
  });

  it.each([
    {
      status: OrderStatus.STARTED,
      itemCount: 0,
      allowed: [OrderAction.ADD_ITEMS, OrderAction.CANCEL, OrderAction.EXPIRE],
    },
    {
      status: OrderStatus.SELECTING_PRODUCTS,
      itemCount: 3,
      allowed: [
        OrderAction.ADD_ITEMS,
        OrderAction.REMOVE_ITEMS,
        OrderAction.REVIEW,
        OrderAction.SET_CUSTOMER_DETAILS,
        OrderAction.CANCEL,
        OrderAction.EXPIRE,
      ],
    },
    {
      status: OrderStatus.COLLECTING_CUSTOMER_DATA,
      itemCount: 3,
      allowed: [
        OrderAction.ADD_ITEMS,
        OrderAction.REMOVE_ITEMS,
        OrderAction.SET_CUSTOMER_DETAILS,
        OrderAction.CANCEL,
        OrderAction.EXPIRE,
      ],
    },
    {
      status: OrderStatus.CONFIRMING_ORDER,
      itemCount: 3,
      allowed: [
        OrderAction.ADD_ITEMS,
        OrderAction.REMOVE_ITEMS,
        OrderAction.SET_CUSTOMER_DETAILS,
        OrderAction.CONFIRM,
        OrderAction.CANCEL,
        OrderAction.EXPIRE,
      ],
    },
    { status: OrderStatus.CONFIRMED, itemCount: 3, allowed: [] },
  ])('reports application-owned actions for $status', ({ status, itemCount, allowed }) => {
    expect(stateMachine.getAllowedActions(status, itemCount, true)).toEqual(allowed);
  });

  it.each([
    OrderStatus.STARTED,
    OrderStatus.SELECTING_PRODUCTS,
    OrderStatus.COLLECTING_CUSTOMER_DATA,
    OrderStatus.CONFIRMING_ORDER,
  ])('cancels an active order from %s', (status) => {
    expect(stateMachine.transition({ status, action: OrderAction.CANCEL, itemCount: 0 })).toBe(
      OrderStatus.CANCELLED,
    );
  });

  it.each([
    OrderStatus.STARTED,
    OrderStatus.SELECTING_PRODUCTS,
    OrderStatus.COLLECTING_CUSTOMER_DATA,
    OrderStatus.CONFIRMING_ORDER,
  ])('expires an active order from %s', (status) => {
    expect(stateMachine.transition({ status, action: OrderAction.EXPIRE, itemCount: 0 })).toBe(
      OrderStatus.EXPIRED,
    );
  });

  describe('given an invalid active order transition', () => {
    it.each([
      { status: OrderStatus.STARTED, action: OrderAction.REMOVE_ITEMS },
      { status: OrderStatus.STARTED, action: OrderAction.REVIEW },
      { status: OrderStatus.STARTED, action: OrderAction.CONFIRM },
      { status: OrderStatus.SELECTING_PRODUCTS, action: OrderAction.CONFIRM },
      { status: OrderStatus.CONFIRMING_ORDER, action: OrderAction.REVIEW },
    ])('rejects $action while the order is $status', ({ status, action }) => {
      expect(() => stateMachine.transition({ status, action, itemCount: 1 })).toThrow(
        InvalidOrderTransitionError,
      );
    });

    it.each([
      { status: OrderStatus.STARTED, action: OrderAction.ADD_ITEMS },
      { status: OrderStatus.SELECTING_PRODUCTS, action: OrderAction.REVIEW },
      { status: OrderStatus.CONFIRMING_ORDER, action: OrderAction.CONFIRM },
    ])('rejects $action without items', ({ status, action }) => {
      expect(() => stateMachine.transition({ status, action, itemCount: 0 })).toThrow(
        `Cannot apply ${action} to an order without items`,
      );
    });

    it('rejects confirmation until both customer details are present', () => {
      expect(() =>
        stateMachine.transition({
          status: OrderStatus.CONFIRMING_ORDER,
          action: OrderAction.CONFIRM,
          itemCount: 1,
          customerDetailsComplete: false,
        }),
      ).toThrow('Cannot confirm an order without customer name and phone');
    });
  });

  describe('given a terminal order', () => {
    it.each([OrderStatus.CONFIRMED, OrderStatus.CANCELLED, OrderStatus.EXPIRED])(
      'identifies %s as terminal and rejects further changes',
      (status) => {
        expect(isTerminalOrderStatus(status)).toBe(true);
        expect(() =>
          stateMachine.transition({ status, action: OrderAction.ADD_ITEMS, itemCount: 1 }),
        ).toThrow(InvalidOrderTransitionError);
      },
    );
  });

  it.each([-1, 1.5, Number.NaN])('rejects the invalid item count %s', (itemCount) => {
    expect(() =>
      stateMachine.transition({
        status: OrderStatus.STARTED,
        action: OrderAction.ADD_ITEMS,
        itemCount,
      }),
    ).toThrow('Order item count must be a non-negative integer');
  });
});
