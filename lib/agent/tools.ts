import { OrderStatus, RefundDecision } from '@prisma/client'
import { prisma } from '../prisma'
import type {
  AnyToolOutput,
  CheckRefundPolicyInput,
  CheckRefundPolicyResult,
  EscalateToHumanInput,
  EscalateToHumanResult,
  IssueRefundInput,
  IssueRefundResult,
  LookupCustomerInput,
  LookupCustomerResult,
  LookupOrderInput,
  LookupOrderResult,
  ToolCall,
} from './types'

// ─── Implementations ──────────────────────────────────────────────────────────

async function lookupCustomer(input: LookupCustomerInput): Promise<LookupCustomerResult> {
  if (!input.customerId && !input.email) {
    return { found: false, error: 'Must provide either customerId or email.' }
  }
  const customer = await prisma.customer.findFirst({
    where: input.customerId ? { id: input.customerId } : { email: input.email },
    include: { orders: { select: { id: true } } },
  })
  if (!customer) return { found: false, error: 'No customer found with that ID or email.' }
  return {
    found: true,
    customerId: customer.id,
    name: customer.name,
    email: customer.email,
    orderIds: customer.orders.map((o) => o.id),
  }
}

async function lookupOrder(input: LookupOrderInput): Promise<LookupOrderResult> {
  const order = await prisma.order.findUnique({ where: { id: input.orderId } })
  if (!order) return { found: false, error: 'Order not found.' }
  return {
    found: true,
    orderId: order.id,
    customerId: order.customerId,
    itemName: order.itemName,
    amount: order.amount,
    purchaseDate: order.purchaseDate.toISOString(),
    status: order.status,
    isFinalSale: order.isFinalSale,
  }
}

/**
 * Pure policy evaluation — no DB access.
 * The agent passes values it already retrieved via lookupOrder.
 * issueRefund also independently re-checks to guard against a rogue agent.
 */
function checkRefundPolicy(input: CheckRefundPolicyInput): CheckRefundPolicyResult {
  // Step 1: delivered?
  if (input.status !== 'DELIVERED') {
    return {
      verdict: {
        action: 'DENY',
        reason: `Order status is "${input.status}". Refunds are only available for DELIVERED orders.`,
        clausesCited: ['Section 4: Order Status Requirements'],
      },
    }
  }

  // Step 2: final sale?
  if (input.isFinalSale) {
    return {
      verdict: {
        action: 'DENY',
        reason: 'This item was marked as Final Sale and cannot be refunded under any circumstances.',
        clausesCited: ['Section 2: Final Sale Items'],
      },
    }
  }

  // Step 3: within 30-day window?
  const purchaseDate = new Date(input.purchaseDate)
  const ageMs = Date.now() - purchaseDate.getTime()
  const ageDays = ageMs / (1000 * 60 * 60 * 24)
  if (ageDays > 30) {
    return {
      verdict: {
        action: 'DENY',
        reason: `This order is ${Math.floor(ageDays)} days old. Refunds must be requested within 30 days of purchase.`,
        clausesCited: ['Section 1: Eligibility Window'],
      },
    }
  }

  // Step 4: amount > $500 → must escalate
  if (input.amount > 500) {
    return {
      verdict: {
        action: 'ESCALATE',
        reason: `Order total $${input.amount.toFixed(2)} exceeds $500 and requires human agent review before a refund can be issued.`,
        clausesCited: ['Section 3: High-Value Refunds (Over $500)'],
      },
    }
  }

  // All checks pass → approve
  return {
    verdict: {
      action: 'APPROVE',
      reason: `Order is fully eligible: status DELIVERED, not a final sale item, purchased ${Math.floor(ageDays)} day(s) ago (within 30-day window), amount $${input.amount.toFixed(2)} (≤ $500 threshold).`,
      clausesCited: ['Section 1: Eligibility Window', 'Section 4: Order Status Requirements'],
    },
  }
}

async function escalateToHuman(input: EscalateToHumanInput): Promise<EscalateToHumanResult> {
  const order = await prisma.order.findUnique({ where: { id: input.orderId } })
  if (!order) return { success: false, error: 'Order not found.' }
  if (order.status === OrderStatus.ESCALATED) {
    return { success: false, error: 'Order is already escalated.' }
  }

  const [tx] = await prisma.$transaction([
    prisma.refundTransaction.create({
      data: {
        orderId: input.orderId,
        decision: RefundDecision.ESCALATED,
        reasoning: input.reason,
      },
    }),
    prisma.order.update({
      where: { id: input.orderId },
      data: { status: OrderStatus.ESCALATED },
    }),
  ])

  return { success: true, transactionId: tx.id }
}

async function issueRefund(input: IssueRefundInput): Promise<IssueRefundResult> {
  const order = await prisma.order.findUnique({ where: { id: input.orderId } })
  if (!order) return { success: false, error: 'Order not found.' }

  // Server-side policy re-check — defence-in-depth.
  // Even if the LLM tries to skip checkRefundPolicy, this gate holds.
  if (order.status !== OrderStatus.DELIVERED) {
    return { success: false, error: `Cannot refund: order status is ${order.status}.` }
  }
  if (order.isFinalSale) {
    return { success: false, error: 'Cannot refund: final sale item.' }
  }
  const ageDays = (Date.now() - order.purchaseDate.getTime()) / (1000 * 60 * 60 * 24)
  if (ageDays > 30) {
    return { success: false, error: `Cannot refund: order is ${Math.floor(ageDays)} days old, outside the 30-day window.` }
  }
  if (order.amount > 500) {
    return { success: false, error: `Cannot auto-refund: amount $${order.amount.toFixed(2)} exceeds $500 limit. Use escalateToHuman instead.` }
  }

  const [tx] = await prisma.$transaction([
    prisma.refundTransaction.create({
      data: {
        orderId: input.orderId,
        decision: RefundDecision.APPROVED,
        reasoning: 'All policy checks passed. Refund auto-approved.',
      },
    }),
    prisma.order.update({
      where: { id: input.orderId },
      data: { status: OrderStatus.REFUNDED },
    }),
  ])

  return { success: true, transactionId: tx.id }
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export async function dispatchTool(call: ToolCall): Promise<AnyToolOutput> {
  switch (call.name) {
    case 'lookupCustomer':    return lookupCustomer(call.input)
    case 'lookupOrder':       return lookupOrder(call.input)
    case 'checkRefundPolicy': return checkRefundPolicy(call.input)
    case 'escalateToHuman':   return escalateToHuman(call.input)
    case 'issueRefund':       return issueRefund(call.input)
  }
}
