import Anthropic from '@anthropic-ai/sdk'
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { buildSystemPrompt } from './system-prompt'
import { dispatchTool } from './tools'
import type { AgentMessage, AgentResult, AnyToolOutput, ToolCall } from './types'

const anthropic = new Anthropic()

const MODEL = 'claude-sonnet-4-6'
const MAX_TURNS = 10 // guard against infinite loops

// ─── Tool definitions (JSON Schema) ──────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'lookupCustomer',
    description:
      'Find a customer by their ID or email address. Returns their name, email, and the IDs of all their orders.',
    input_schema: {
      type: 'object' as const,
      properties: {
        customerId: { type: 'string', description: 'Customer UUID' },
        email: { type: 'string', description: 'Customer email address' },
      },
    },
  },
  {
    name: 'lookupOrder',
    description:
      'Retrieve order details by order ID: item name, amount, purchase date, delivery status, and whether it is a final sale item.',
    input_schema: {
      type: 'object' as const,
      properties: {
        orderId: { type: 'string', description: 'Order UUID' },
      },
      required: ['orderId'],
    },
  },
  {
    name: 'checkRefundPolicy',
    description:
      'Check whether an order is eligible for a refund under the current policy. Returns a verdict of APPROVE, DENY, or ESCALATE with the relevant policy clauses cited. Always call this before issueRefund or escalateToHuman.',
    input_schema: {
      type: 'object' as const,
      properties: {
        amount: { type: 'number', description: 'Order amount in USD' },
        isFinalSale: { type: 'boolean', description: 'Whether the item was marked as final sale' },
        purchaseDate: { type: 'string', description: 'ISO 8601 purchase date from the order record' },
        status: {
          type: 'string',
          enum: ['PENDING', 'DELIVERED', 'REFUNDED', 'ESCALATED'],
          description: 'Current order status',
        },
      },
      required: ['amount', 'isFinalSale', 'purchaseDate', 'status'],
    },
  },
  {
    name: 'escalateToHuman',
    description:
      'Escalate a refund request to a human agent. Use when checkRefundPolicy returns ESCALATE, or when the situation requires human judgment. Creates an audit record and marks the order as escalated.',
    input_schema: {
      type: 'object' as const,
      properties: {
        orderId: { type: 'string', description: 'Order UUID to escalate' },
        reason: { type: 'string', description: 'Clear reason for escalation, e.g. "Amount $750 exceeds $500 auto-approval limit."' },
      },
      required: ['orderId', 'reason'],
    },
  },
  {
    name: 'issueRefund',
    description:
      'Issue a refund for an order. Only call this after checkRefundPolicy returns action: APPROVE. The tool independently re-verifies eligibility — it will fail if policy conditions are not met.',
    input_schema: {
      type: 'object' as const,
      properties: {
        orderId: { type: 'string', description: 'Order UUID to refund' },
      },
      required: ['orderId'],
    },
  },
]

// ─── Trace logging ────────────────────────────────────────────────────────────

async function logTrace(params: {
  sessionId: string
  toolName: string
  toolInput: Record<string, unknown>
  toolOutput: AnyToolOutput
  latencyMs: number
  inputTokens: number
  outputTokens: number
  isRetry: boolean
  errorMsg?: string
}) {
  await prisma.traceLog.create({
    data: {
      sessionId: params.sessionId,
      toolName: params.toolName,
      toolInput: params.toolInput as Prisma.InputJsonValue,
      toolOutput: JSON.parse(JSON.stringify(params.toolOutput)) as Prisma.InputJsonValue,
      latencyMs: params.latencyMs,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      isRetry: params.isRetry,
      errorMsg: params.errorMsg ?? null,
    },
  })
}

// ─── Agent loop ───────────────────────────────────────────────────────────────

export async function runAgent(params: {
  sessionId: string
  customerId: string
  userMessage: string
  history?: AgentMessage[]
}): Promise<AgentResult> {
  const { sessionId, customerId, userMessage } = params

  // Build the full message list for this turn
  const messages: Anthropic.MessageParam[] = [
    ...(params.history ?? []).map(toAnthropicParam),
    { role: 'user', content: userMessage },
  ]

  let inputTokensTotal = 0
  let outputTokensTotal = 0
  let turns = 0

  while (turns < MAX_TURNS) {
    turns++

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: buildSystemPrompt(customerId),
      tools: TOOLS,
      messages,
    })

    inputTokensTotal += response.usage.input_tokens
    outputTokensTotal += response.usage.output_tokens

    // Collect tool_use blocks from this response
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    )

    if (response.stop_reason === 'end_turn' || toolUseBlocks.length === 0) {
      // Final text response
      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
      const finalText = textBlock?.text ?? ''

      // Append this final assistant turn to history
      messages.push({ role: 'assistant', content: response.content })

      return {
        response: finalText,
        updatedHistory: messages.map(fromAnthropicParam),
      }
    }

    // Run all tool calls in this turn (usually one, but Claude can batch)
    const toolResults: Anthropic.ToolResultBlockParam[] = []

    for (const block of toolUseBlocks) {
      const toolInput = block.input as Record<string, unknown>
      const toolCall = { name: block.name, input: toolInput } as ToolCall

      let output: AnyToolOutput
      let errorMsg: string | undefined
      let isRetry = false
      const start = Date.now()

      try {
        output = await dispatchTool(toolCall, customerId)
      } catch (err) {
        // Retry once on transient errors (e.g. DB connection blip)
        isRetry = true
        try {
          output = await dispatchTool(toolCall, customerId)
        } catch (retryErr) {
          errorMsg = retryErr instanceof Error ? retryErr.message : String(retryErr)
          output = { found: false, error: errorMsg } as AnyToolOutput
        }
      }

      const latencyMs = Date.now() - start

      await logTrace({
        sessionId,
        toolName: block.name,
        toolInput,
        toolOutput: output,
        latencyMs,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        isRetry,
        errorMsg,
      })

      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(output),
      })
    }

    // Append assistant turn (with tool_use blocks) and tool results
    messages.push({ role: 'assistant', content: response.content })
    messages.push({ role: 'user', content: toolResults })
  }

  // Hit MAX_TURNS — return a safe fallback
  return {
    response: 'I was unable to complete your request. Please contact support directly.',
    updatedHistory: messages.map(fromAnthropicParam),
  }
}

// ─── Serialisation helpers ────────────────────────────────────────────────────
// AgentMessage is a serialisable subset of Anthropic.MessageParam.
// These convert between the two so the API route can JSON.stringify history.

function toAnthropicParam(msg: AgentMessage): Anthropic.MessageParam {
  return msg as Anthropic.MessageParam
}

function fromAnthropicParam(msg: Anthropic.MessageParam): AgentMessage {
  return msg as AgentMessage
}
