# Fix the import in payment-requests.service.ts
with open('src/features/payment-requests/payment-requests.service.ts', 'r') as f:
    c = f.read()

c = c.replace(
    "import { performInternalTransfer } from '../transfers/transfers.service';",
    "import { executeInternalTransfer } from '../transfers/transfers.service';"
)
c = c.replace(
    "  const result = await performInternalTransfer(receiverId, {",
    "  const result = await executeInternalTransfer(receiverId, {"
)

with open('src/features/payment-requests/payment-requests.service.ts', 'w') as f:
    f.write(c)
print("fixed")
