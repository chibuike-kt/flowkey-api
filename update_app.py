with open('src/features/bills/bills.service.ts', 'r') as f:
    c = f.read()

c = c.replace(
    "jobId:    `reconcile:${billId}:attempt:${attempt}`,",
    "jobId:    `reconcile_${billId}_attempt_${attempt}`,"
)


with open('src/features/bills/bills.service.ts', 'w') as f:
    f.write(c)
print("fixed")
