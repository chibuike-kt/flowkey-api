with open('prisma/schema.prisma', 'r') as f:
    c = f.read()

# Add available_balance and pending_balance to Wallet model
c = c.replace(
    """model Wallet {
  id         String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  user_id    String    @unique @db.Uuid
  deleted_at DateTime? @db.Timestamptz
  created_at DateTime  @default(now()) @db.Timestamptz
  updated_at DateTime  @updatedAt @db.Timestamptz""",
    """model Wallet {
  id                String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  user_id           String    @unique @db.Uuid
  available_balance BigInt    @default(0)
  pending_balance   BigInt    @default(0)
  deleted_at        DateTime? @db.Timestamptz
  created_at        DateTime  @default(now()) @db.Timestamptz
  updated_at        DateTime  @updatedAt @db.Timestamptz"""
)

# Update BillTransaction status enum comment and add new fields
c = c.replace(
    """  status            String         @default("pending") @db.VarChar(20)
  amount            BigInt
  fee               BigInt         @default(0)
  narration         String         @db.VarChar(255)
  recipient         Json           @default("{}")
  purchased_code    String?
  units             String?        @db.VarChar(50)
  provider_response String?""",
    """  status            String         @default("pending") @db.VarChar(30)
  amount            BigInt
  fee               BigInt         @default(0)
  narration         String         @db.VarChar(255)
  idempotency_key   String?        @db.VarChar(100)
  recipient         Json           @default("{}")
  purchased_code    String?
  units             String?        @db.VarChar(50)
  provider_response String?"""
)

# Add new indexes to BillTransaction
c = c.replace(
    """  @@index([created_at(sort: Desc)])
  @@map("bill_transactions")""",
    """  @@index([created_at(sort: Desc)])
  @@index([status, created_at])
  @@index([user_id, status])
  @@unique([user_id, idempotency_key])
  @@map("bill_transactions")"""
)

with open('prisma/schema.prisma', 'w') as f:
    f.write(c)
print("schema updated")
