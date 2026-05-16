# kyc.router.ts
with open('src/features/kyc/kyc.router.ts', 'r') as f:
    c = f.read()

c = c.replace(
    "import { requireAuth } from '../../common/middleware/requireAuth';",
    "import { requireAuth } from '../../common/middleware/requireAuth';\nimport { requireFlag } from '../../common/middleware/featureFlag';"
)

# Wrap the upgrade endpoint — check which route pattern exists
if "router.post('/upgrade'" in c:
    c = c.replace(
        "router.post('/upgrade',",
        "router.post('/upgrade', requireFlag('kyc.tier2'),"
    )
elif "router.post('/'," in c:
    c = c.replace(
        "router.post('/',",
        "router.post('/', requireFlag('kyc.tier2'),"
    )

with open('src/features/kyc/kyc.router.ts', 'w') as f:
    f.write(c)
print("kyc.router.ts updated")

