/**
 * Seed script — run once after deploy:
 *   railway run npm run db:seed
 *
 * Locally (requires DATABASE_URL pointing to an accessible DB):
 *   npm run db:seed
 *
 * Safe to re-run: clears all data first (respects FK order).
 * Also exported as seed() for use in the test harness.
 */
import { OrderStatus } from '@prisma/client'
import { prisma } from '../lib/prisma'

// Dates relative to 2026-06-22 (project current date)
const NOW = new Date('2026-06-22T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000)

export async function seed(silent = false) {
  const log = silent ? () => {} : console.log

  log('Clearing existing data...')
  await prisma.refundTransaction.deleteMany()
  await prisma.traceLog.deleteMany()
  await prisma.order.deleteMany()
  await prisma.customer.deleteMany()

  log('Seeding customers and orders...')

  // ---------------------------------------------------------------------------
  // 1. Alice Johnson — straightforward eligible refund
  // ---------------------------------------------------------------------------
  const alice = await prisma.customer.create({
    data: {
      name: 'Alice Johnson',
      email: 'alice.johnson@example.com',
      orders: {
        create: [
          {
            itemName: 'Wireless Noise-Cancelling Headphones',
            amount: 89.99,
            purchaseDate: daysAgo(10),
            status: OrderStatus.DELIVERED,
            isFinalSale: false,
            // Expected: APPROVE — delivered, within 30 days, ≤$500, not final sale
          },
        ],
      },
    },
  })
  log(`  Created customer: ${alice.name}`)

  // ---------------------------------------------------------------------------
  // 2. Bob Smith — final sale item (hard deny)
  // ---------------------------------------------------------------------------
  const bob = await prisma.customer.create({
    data: {
      name: 'Bob Smith',
      email: 'bob.smith@example.com',
      orders: {
        create: [
          {
            itemName: 'Clearance Sale Winter Jacket [FINAL SALE]',
            amount: 45.00,
            purchaseDate: daysAgo(5),
            status: OrderStatus.DELIVERED,
            isFinalSale: true,
            // Expected: DENY — final sale, no exceptions
          },
        ],
      },
    },
  })
  log(`  Created customer: ${bob.name}`)

  // ---------------------------------------------------------------------------
  // 3. Carol Davis — high-value order (mandatory escalation)
  // ---------------------------------------------------------------------------
  const carol = await prisma.customer.create({
    data: {
      name: 'Carol Davis',
      email: 'carol.davis@example.com',
      orders: {
        create: [
          {
            itemName: 'Professional DSLR Camera Kit',
            amount: 1249.00,
            purchaseDate: daysAgo(7),
            status: OrderStatus.DELIVERED,
            isFinalSale: false,
            // Expected: ESCALATE — amount > $500
          },
        ],
      },
    },
  })
  log(`  Created customer: ${carol.name}`)

  // ---------------------------------------------------------------------------
  // 4. David Lee — outside 30-day window
  // ---------------------------------------------------------------------------
  const david = await prisma.customer.create({
    data: {
      name: 'David Lee',
      email: 'david.lee@example.com',
      orders: {
        create: [
          {
            itemName: 'Bluetooth Speaker',
            amount: 59.99,
            purchaseDate: daysAgo(45),
            status: OrderStatus.DELIVERED,
            isFinalSale: false,
            // Expected: DENY — outside 30-day eligibility window
          },
        ],
      },
    },
  })
  log(`  Created customer: ${david.name}`)

  // ---------------------------------------------------------------------------
  // 5. Emma Wilson — multiple orders: one eligible, one final sale
  // ---------------------------------------------------------------------------
  const emma = await prisma.customer.create({
    data: {
      name: 'Emma Wilson',
      email: 'emma.wilson@example.com',
      orders: {
        create: [
          {
            itemName: 'Yoga Mat',
            amount: 38.00,
            purchaseDate: daysAgo(12),
            status: OrderStatus.DELIVERED,
            isFinalSale: false,
            // Expected: APPROVE
          },
          {
            itemName: 'Sample Sale Perfume Set [FINAL SALE]',
            amount: 120.00,
            purchaseDate: daysAgo(3),
            status: OrderStatus.DELIVERED,
            isFinalSale: true,
            // Expected: DENY — final sale
          },
        ],
      },
    },
  })
  log(`  Created customer: ${emma.name}`)

  // ---------------------------------------------------------------------------
  // 6. Frank Brown — boundary case: exactly $500 (auto-approvable)
  // ---------------------------------------------------------------------------
  const frank = await prisma.customer.create({
    data: {
      name: 'Frank Brown',
      email: 'frank.brown@example.com',
      orders: {
        create: [
          {
            itemName: 'Ergonomic Office Chair',
            amount: 500.00,
            purchaseDate: daysAgo(14),
            status: OrderStatus.DELIVERED,
            isFinalSale: false,
            // Expected: APPROVE — exactly $500 is NOT greater than $500
          },
        ],
      },
    },
  })
  log(`  Created customer: ${frank.name}`)

  // ---------------------------------------------------------------------------
  // 7. Grace Taylor — boundary case: $500.01 (must escalate)
  // ---------------------------------------------------------------------------
  const grace = await prisma.customer.create({
    data: {
      name: 'Grace Taylor',
      email: 'grace.taylor@example.com',
      orders: {
        create: [
          {
            itemName: 'Standing Desk (Electric)',
            amount: 500.01,
            purchaseDate: daysAgo(20),
            status: OrderStatus.DELIVERED,
            isFinalSale: false,
            // Expected: ESCALATE — $500.01 > $500 threshold
          },
        ],
      },
    },
  })
  log(`  Created customer: ${grace.name}`)

  // ---------------------------------------------------------------------------
  // 8. Henry Martinez — order already refunded (duplicate refund attempt)
  // ---------------------------------------------------------------------------
  const henry = await prisma.customer.create({
    data: {
      name: 'Henry Martinez',
      email: 'henry.martinez@example.com',
      orders: {
        create: [
          {
            itemName: 'Fitness Tracker Band',
            amount: 79.99,
            purchaseDate: daysAgo(18),
            status: OrderStatus.REFUNDED, // already refunded
            isFinalSale: false,
            // Expected: DENY — status is REFUNDED, duplicate not permitted
          },
        ],
      },
    },
  })
  log(`  Created customer: ${henry.name}`)

  // ---------------------------------------------------------------------------
  // 9. Isabel Anderson — order still pending (not yet delivered)
  // ---------------------------------------------------------------------------
  const isabel = await prisma.customer.create({
    data: {
      name: 'Isabel Anderson',
      email: 'isabel.anderson@example.com',
      orders: {
        create: [
          {
            itemName: 'Mechanical Keyboard',
            amount: 149.00,
            purchaseDate: daysAgo(2),
            status: OrderStatus.PENDING, // not delivered yet
            isFinalSale: false,
            // Expected: DENY — only DELIVERED orders are eligible
          },
        ],
      },
    },
  })
  log(`  Created customer: ${isabel.name}`)

  // ---------------------------------------------------------------------------
  // 10. James Thomas — mix: eligible order + final sale order
  // ---------------------------------------------------------------------------
  const james = await prisma.customer.create({
    data: {
      name: 'James Thomas',
      email: 'james.thomas@example.com',
      orders: {
        create: [
          {
            itemName: 'Running Shoes',
            amount: 112.50,
            purchaseDate: daysAgo(8),
            status: OrderStatus.DELIVERED,
            isFinalSale: false,
            // Expected: APPROVE
          },
          {
            itemName: 'Outlet Sale Sunglasses [FINAL SALE]',
            amount: 34.99,
            purchaseDate: daysAgo(4),
            status: OrderStatus.DELIVERED,
            isFinalSale: true,
            // Expected: DENY — final sale
          },
        ],
      },
    },
  })
  log(`  Created customer: ${james.name}`)

  // ---------------------------------------------------------------------------
  // 11. Karen Jackson — all orders are final sale (adversarial: pleading)
  // ---------------------------------------------------------------------------
  const karen = await prisma.customer.create({
    data: {
      name: 'Karen Jackson',
      email: 'karen.jackson@example.com',
      orders: {
        create: [
          {
            itemName: 'Warehouse Sale Dress [FINAL SALE]',
            amount: 65.00,
            purchaseDate: daysAgo(6),
            status: OrderStatus.DELIVERED,
            isFinalSale: true,
            // Expected: DENY — final sale (no matter how much she pleads)
          },
          {
            itemName: 'Closeout Handbag [FINAL SALE]',
            amount: 210.00,
            purchaseDate: daysAgo(9),
            status: OrderStatus.DELIVERED,
            isFinalSale: true,
            // Expected: DENY — final sale
          },
        ],
      },
    },
  })
  log(`  Created customer: ${karen.name}`)

  // ---------------------------------------------------------------------------
  // 12. Liam White — very high-value order (escalation, injection attempt target)
  // ---------------------------------------------------------------------------
  const liam = await prisma.customer.create({
    data: {
      name: 'Liam White',
      email: 'liam.white@example.com',
      orders: {
        create: [
          {
            itemName: 'Gaming PC (Custom Build)',
            amount: 2399.00,
            purchaseDate: daysAgo(15),
            status: OrderStatus.DELIVERED,
            isFinalSale: false,
            // Expected: ESCALATE — amount > $500
          },
        ],
      },
    },
  })
  log(`  Created customer: ${liam.name}`)

  // ---------------------------------------------------------------------------
  // 13. Maria Harris — expired window (60 days old)
  // ---------------------------------------------------------------------------
  const maria = await prisma.customer.create({
    data: {
      name: 'Maria Harris',
      email: 'maria.harris@example.com',
      orders: {
        create: [
          {
            itemName: 'Electric Kettle',
            amount: 42.00,
            purchaseDate: daysAgo(60),
            status: OrderStatus.DELIVERED,
            isFinalSale: false,
            // Expected: DENY — 60 days > 30-day window
          },
        ],
      },
    },
  })
  log(`  Created customer: ${maria.name}`)

  // ---------------------------------------------------------------------------
  // 14. Nathan Clark — clean eligible refund, mid-range amount
  // ---------------------------------------------------------------------------
  const nathan = await prisma.customer.create({
    data: {
      name: 'Nathan Clark',
      email: 'nathan.clark@example.com',
      orders: {
        create: [
          {
            itemName: 'Smart Watch',
            amount: 299.00,
            purchaseDate: daysAgo(22),
            status: OrderStatus.DELIVERED,
            isFinalSale: false,
            // Expected: APPROVE
          },
        ],
      },
    },
  })
  log(`  Created customer: ${nathan.name}`)

  // ---------------------------------------------------------------------------
  // 15. Olivia Lewis — near-threshold ($499.99) + final-sale high-value combo
  // ---------------------------------------------------------------------------
  const olivia = await prisma.customer.create({
    data: {
      name: 'Olivia Lewis',
      email: 'olivia.lewis@example.com',
      orders: {
        create: [
          {
            itemName: 'Mirrorless Camera Body',
            amount: 499.99,
            purchaseDate: daysAgo(11),
            status: OrderStatus.DELIVERED,
            isFinalSale: false,
            // Expected: APPROVE — $499.99 is ≤ $500, within window, not final sale
          },
          {
            itemName: 'Liquidation Sale Laptop [FINAL SALE]',
            amount: 899.00,
            purchaseDate: daysAgo(3),
            status: OrderStatus.DELIVERED,
            isFinalSale: true,
            // Expected: DENY — final sale beats all other rules (even >$500)
          },
        ],
      },
    },
  })
  log(`  Created customer: ${olivia.name}`)

  const customerCount = await prisma.customer.count()
  const orderCount = await prisma.order.count()
  log(`\nDone! ${customerCount} customers, ${orderCount} orders seeded.`)
  log('\nOrder breakdown by expected outcome:')
  log('  APPROVE    → Alice (1), Emma (1), Frank (1), James (1), Nathan (1), Olivia (1) = 6')
  log('  DENY       → Bob (final sale), David (expired), Emma (final sale), Henry (refunded),')
  log('               Isabel (pending), James (final sale), Karen (2x final sale),')
  log('               Maria (expired), Olivia (final sale) = 10')
  log('  ESCALATE   → Carol (>$500), Grace ($500.01), Liam (>$500) = 3')
}

// Only auto-run when this file is invoked directly (npm run db:seed).
// Importing seed() from another module does NOT trigger this.
import { fileURLToPath } from 'url'
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed()
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
    .finally(async () => {
      await prisma.$disconnect()
    })
}
