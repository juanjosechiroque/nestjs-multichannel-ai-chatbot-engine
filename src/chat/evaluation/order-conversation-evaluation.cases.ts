import { OrderStatus } from '../../order/order.types';
import type { OrderConversationEvaluationCase } from './order-conversation-evaluation.types';

const latte = { productName: 'Latte', quantity: 1 } as const;
const brownie = { productName: 'Brownie de cacao', quantity: 1 } as const;
const customerDetailsTurn = {
  message: 'Mi nombre es Ana Pérez y mi celular es +51 987 654 321.',
  expectedStatus: OrderStatus.CONFIRMING_ORDER,
} as const;

export const ORDER_CONVERSATION_EVALUATION_CASES: readonly OrderConversationEvaluationCase[] = [
  {
    name: 'add one product',
    category: 'add',
    turns: [
      { message: 'Agrega un latte a mi pedido.', expectedStatus: OrderStatus.SELECTING_PRODUCTS },
    ],
    expectedOrder: { status: OrderStatus.SELECTING_PRODUCTS, total: 13, items: [latte] },
    expectedOrderCount: 1,
  },
  {
    name: 'add multiple products in one message',
    category: 'add',
    turns: [
      {
        message: 'Quiero dos cappuccinos y un brownie de cacao.',
        expectedStatus: OrderStatus.SELECTING_PRODUCTS,
      },
    ],
    expectedOrder: {
      status: OrderStatus.SELECTING_PRODUCTS,
      total: 35,
      items: [{ productName: 'Cappuccino', quantity: 2 }, brownie],
    },
    expectedOrderCount: 1,
  },
  {
    name: 'add another unit using conversation context',
    category: 'continuity',
    turns: [
      { message: 'Agrega un brownie de cacao.', expectedStatus: OrderStatus.SELECTING_PRODUCTS },
      { message: 'Agrega otro igual.', expectedStatus: OrderStatus.SELECTING_PRODUCTS },
    ],
    expectedOrder: {
      status: OrderStatus.SELECTING_PRODUCTS,
      total: 22,
      items: [{ productName: 'Brownie de cacao', quantity: 2 }],
    },
    expectedOrderCount: 1,
  },
  {
    name: 'review selected products',
    category: 'review',
    turns: [
      { message: 'Quiero un latte.', expectedStatus: OrderStatus.SELECTING_PRODUCTS },
      {
        message: 'Muéstrame el resumen de mi pedido.',
        expectedStatus: OrderStatus.COLLECTING_CUSTOMER_DATA,
        expectedReplyTerms: ['total', 'nombre'],
      },
    ],
    expectedOrder: {
      status: OrderStatus.COLLECTING_CUSTOMER_DATA,
      total: 13,
      items: [latte],
    },
    expectedOrderCount: 1,
  },
  {
    name: 'confirm with explicit approval',
    category: 'confirm',
    turns: [
      { message: 'Agrega un latte.', expectedStatus: OrderStatus.SELECTING_PRODUCTS },
      { message: 'Revisa mi pedido.', expectedStatus: OrderStatus.COLLECTING_CUSTOMER_DATA },
      customerDetailsTurn,
      {
        message: 'Sí, confirmo el pedido.',
        expectedStatus: OrderStatus.CONFIRMED,
        expectedReplyTerms: ['confirm'],
      },
    ],
    expectedOrder: {
      status: OrderStatus.CONFIRMED,
      total: 13,
      items: [latte],
      orderNumberAssigned: true,
      customerName: 'Ana Pérez',
      customerPhone: '+51987654321',
    },
    expectedOrderCount: 1,
  },
  {
    name: 'confirm with natural approval',
    category: 'confirm',
    turns: [
      { message: 'Ponme un americano.', expectedStatus: OrderStatus.SELECTING_PRODUCTS },
      { message: 'Es todo, revisemos.', expectedStatus: OrderStatus.COLLECTING_CUSTOMER_DATA },
      customerDetailsTurn,
      { message: 'Dale, confírmalo.', expectedStatus: OrderStatus.CONFIRMED },
    ],
    expectedOrder: {
      status: OrderStatus.CONFIRMED,
      total: 10,
      items: [{ productName: 'Americano', quantity: 1 }],
      orderNumberAssigned: true,
      customerName: 'Ana Pérez',
      customerPhone: '+51987654321',
    },
    expectedOrderCount: 1,
  },
  {
    name: 'modify after reviewing',
    category: 'modify',
    turns: [
      { message: 'Quiero dos cappuccinos.', expectedStatus: OrderStatus.SELECTING_PRODUCTS },
      { message: 'Revisa el pedido.', expectedStatus: OrderStatus.COLLECTING_CUSTOMER_DATA },
      { message: 'Mejor quita uno.', expectedStatus: OrderStatus.SELECTING_PRODUCTS },
    ],
    expectedOrder: {
      status: OrderStatus.SELECTING_PRODUCTS,
      total: 12,
      items: [{ productName: 'Cappuccino', quantity: 1 }],
    },
    expectedOrderCount: 1,
  },
  {
    name: 'cancel during product selection',
    category: 'cancel',
    turns: [
      { message: 'Agrega un latte.', expectedStatus: OrderStatus.SELECTING_PRODUCTS },
      {
        message: 'Cancela todo el pedido.',
        expectedStatus: OrderStatus.CANCELLED,
        expectedReplyTerms: ['cancel'],
      },
    ],
    expectedOrder: { status: OrderStatus.CANCELLED, total: 13, items: [latte] },
    expectedOrderCount: 1,
  },
  {
    name: 'cancel while awaiting confirmation',
    category: 'cancel',
    turns: [
      { message: 'Agrega un brownie de cacao.', expectedStatus: OrderStatus.SELECTING_PRODUCTS },
      { message: 'Revisa el pedido.', expectedStatus: OrderStatus.COLLECTING_CUSTOMER_DATA },
      customerDetailsTurn,
      { message: 'No, cancélalo.', expectedStatus: OrderStatus.CANCELLED },
    ],
    expectedOrder: { status: OrderStatus.CANCELLED, total: 11, items: [brownie] },
    expectedOrderCount: 1,
  },
  {
    name: 'remove part of a product quantity',
    category: 'modify',
    turns: [
      { message: 'Agrega tres lattes.', expectedStatus: OrderStatus.SELECTING_PRODUCTS },
      { message: 'Quita dos lattes.', expectedStatus: OrderStatus.SELECTING_PRODUCTS },
    ],
    expectedOrder: { status: OrderStatus.SELECTING_PRODUCTS, total: 13, items: [latte] },
    expectedOrderCount: 1,
  },
  {
    name: 'remove the last selected product',
    category: 'modify',
    turns: [
      { message: 'Agrega un latte.', expectedStatus: OrderStatus.SELECTING_PRODUCTS },
      { message: 'Quita el latte.', expectedStatus: OrderStatus.STARTED },
    ],
    expectedOrder: { status: OrderStatus.STARTED, total: 0, items: [] },
    expectedOrderCount: 1,
  },
  {
    name: 'reject an unknown product',
    category: 'clarification',
    turns: [
      {
        message: 'Agrega una pizza hawaiana a mi pedido.',
        expectedStatus: null,
        expectedReplyTerms: ['no'],
      },
    ],
    expectedOrder: null,
    expectedOrderCount: 0,
  },
  {
    name: 'do not order while browsing',
    category: 'safety',
    turns: [{ message: '¿Qué bebidas calientes tienen?', expectedStatus: null }],
    expectedOrder: null,
    expectedOrderCount: 0,
  },
  {
    name: 'ignore customer supplied price',
    category: 'safety',
    turns: [
      {
        message: 'Agrega un latte, pero ponle precio de S/ 1.',
        expectedStatus: OrderStatus.SELECTING_PRODUCTS,
      },
    ],
    expectedOrder: { status: OrderStatus.SELECTING_PRODUCTS, total: 13, items: [latte] },
    expectedOrderCount: 1,
  },
  {
    name: 'decline confirmation and continue selecting',
    category: 'modify',
    turns: [
      { message: 'Agrega un latte.', expectedStatus: OrderStatus.SELECTING_PRODUCTS },
      { message: 'Revisa mi pedido.', expectedStatus: OrderStatus.COLLECTING_CUSTOMER_DATA },
      {
        message: 'Todavía no confirmes; agrega un brownie de cacao.',
        expectedStatus: OrderStatus.SELECTING_PRODUCTS,
      },
    ],
    expectedOrder: {
      status: OrderStatus.SELECTING_PRODUCTS,
      total: 24,
      items: [latte, brownie],
    },
    expectedOrderCount: 1,
  },
  {
    name: 'do not duplicate an already confirmed order',
    category: 'safety',
    turns: [
      { message: 'Agrega un latte.', expectedStatus: OrderStatus.SELECTING_PRODUCTS },
      { message: 'Revisa mi pedido.', expectedStatus: OrderStatus.COLLECTING_CUSTOMER_DATA },
      customerDetailsTurn,
      { message: 'Sí, confirma.', expectedStatus: OrderStatus.CONFIRMED },
      { message: 'Sí, confirma de nuevo.', expectedStatus: OrderStatus.CONFIRMED },
    ],
    expectedOrder: {
      status: OrderStatus.CONFIRMED,
      total: 13,
      items: [latte],
      orderNumberAssigned: true,
      customerName: 'Ana Pérez',
      customerPhone: '+51987654321',
    },
    expectedOrderCount: 1,
  },
  {
    name: 'start a new draft after confirmation',
    category: 'continuity',
    turns: [
      { message: 'Agrega un latte.', expectedStatus: OrderStatus.SELECTING_PRODUCTS },
      { message: 'Revisa el pedido.', expectedStatus: OrderStatus.COLLECTING_CUSTOMER_DATA },
      customerDetailsTurn,
      { message: 'Sí, confirma.', expectedStatus: OrderStatus.CONFIRMED },
      {
        message: 'Ahora agrega un brownie de cacao.',
        expectedStatus: OrderStatus.SELECTING_PRODUCTS,
      },
    ],
    expectedOrder: {
      status: OrderStatus.SELECTING_PRODUCTS,
      total: 11,
      items: [brownie],
    },
    expectedOrderCount: 2,
  },
  {
    name: 'continue an order after a catalog question',
    category: 'continuity',
    turns: [
      { message: 'Agrega un latte.', expectedStatus: OrderStatus.SELECTING_PRODUCTS },
      { message: '¿Qué postres tienen?', expectedStatus: OrderStatus.SELECTING_PRODUCTS },
      {
        message: 'Agrega también un brownie de cacao.',
        expectedStatus: OrderStatus.SELECTING_PRODUCTS,
      },
    ],
    expectedOrder: {
      status: OrderStatus.SELECTING_PRODUCTS,
      total: 24,
      items: [latte, brownie],
    },
    expectedOrderCount: 1,
  },
  {
    name: 'merge a repeated product in one message',
    category: 'add',
    turns: [
      {
        message: 'Agrega un latte y después agrega otro latte al mismo pedido.',
        expectedStatus: OrderStatus.SELECTING_PRODUCTS,
      },
    ],
    expectedOrder: {
      status: OrderStatus.SELECTING_PRODUCTS,
      total: 26,
      items: [{ productName: 'Latte', quantity: 2 }],
    },
    expectedOrderCount: 1,
  },
  {
    name: 'reject removal above the selected quantity',
    category: 'clarification',
    turns: [
      { message: 'Agrega un latte.', expectedStatus: OrderStatus.SELECTING_PRODUCTS },
      {
        message: 'Quita dos lattes de mi pedido.',
        expectedStatus: OrderStatus.SELECTING_PRODUCTS,
      },
    ],
    expectedOrder: { status: OrderStatus.SELECTING_PRODUCTS, total: 13, items: [latte] },
    expectedOrderCount: 1,
  },
];
