// ─── Tool Inputs ────────────────────────────────────────────────────────────

export interface LookupCustomerInput {
  /** Customer UUID, if known */
  customerId?: string
  /** Customer email address, if customerId is not known */
  email?: string
}

export interface LookupOrderInput {
  orderId: string
}

export interface CheckRefundPolicyInput {
  /** Amount of the order in USD */
  amount: number
  /** Whether the item was marked as final sale */
  isFinalSale: boolean
  /** ISO 8601 purchase date string */
  purchaseDate: string
  /** Order status: PENDING | DELIVERED | REFUNDED | ESCALATED */
  status: string
}

export interface EscalateToHumanInput {
  orderId: string
  /** Clear reason for escalation, will appear in the audit log */
  reason: string
}

export interface IssueRefundInput {
  orderId: string
}

// ─── Tool Outputs ────────────────────────────────────────────────────────────

export interface LookupCustomerResult {
  found: boolean
  customerId?: string
  name?: string
  email?: string
  /** IDs of all orders belonging to this customer */
  orderIds?: string[]
  error?: string
}

export interface LookupOrderResult {
  found: boolean
  orderId?: string
  customerId?: string
  itemName?: string
  amount?: number
  /** ISO 8601 string */
  purchaseDate?: string
  status?: string
  isFinalSale?: boolean
  error?: string
}

export type RefundAction = 'APPROVE' | 'DENY' | 'ESCALATE'

export interface PolicyVerdict {
  action: RefundAction
  reason: string
  clausesCited: string[]
}

export interface CheckRefundPolicyResult {
  verdict: PolicyVerdict
}

export interface EscalateToHumanResult {
  success: boolean
  transactionId?: string
  error?: string
}

export interface IssueRefundResult {
  success: boolean
  transactionId?: string
  error?: string
}

// ─── Discriminated Union — typed tool dispatch ────────────────────────────────
// Using a discriminated union (not Record<string, (args: any) => any>) so
// TypeScript can narrow the input/output types in the switch in tools.ts.

export type ToolCall =
  | { name: 'lookupCustomer';    input: LookupCustomerInput }
  | { name: 'lookupOrder';       input: LookupOrderInput }
  | { name: 'checkRefundPolicy'; input: CheckRefundPolicyInput }
  | { name: 'escalateToHuman';   input: EscalateToHumanInput }
  | { name: 'issueRefund';       input: IssueRefundInput }

export type ToolResult =
  | { name: 'lookupCustomer';    output: LookupCustomerResult }
  | { name: 'lookupOrder';       output: LookupOrderResult }
  | { name: 'checkRefundPolicy'; output: CheckRefundPolicyResult }
  | { name: 'escalateToHuman';   output: EscalateToHumanResult }
  | { name: 'issueRefund';       output: IssueRefundResult }

export type AnyToolOutput =
  | LookupCustomerResult
  | LookupOrderResult
  | CheckRefundPolicyResult
  | EscalateToHumanResult
  | IssueRefundResult

// ─── Agent I/O ───────────────────────────────────────────────────────────────

export interface AgentResult {
  response: string
  /** Full updated message history — pass back on next turn for multi-turn chat */
  updatedHistory: AgentMessage[]
}

// Mirrors Anthropic SDK's MessageParam but serialisable (no File objects)
export type AgentMessage =
  | { role: 'user';      content: string | AgentContentBlock[] }
  | { role: 'assistant'; content: string | AgentContentBlock[] }

export type AgentContentBlock =
  | { type: 'text';        text: string }
  | { type: 'tool_use';    id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }
