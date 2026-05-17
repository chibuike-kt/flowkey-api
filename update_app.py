with open('src/features/transfers/transfers.service.ts', 'r') as f:
    c = f.read()

# The SenderRow interface uses user_auth as a field name — that's fine for TypeScript
# The problem is in Prisma select statements where we use user_auth but the relation is auth
# We need to select `auth` from Prisma but then access it as user_auth in our code
# Simplest fix: rename user_auth → auth in SenderRow and update all references

# Fix SenderRow interface
c = c.replace(
    '  user_auth:    UserAuthRow | null;',
    '  auth:         UserAuthRow | null;'
)

# Fix Prisma select statements — change user_auth: { to auth: {
# There are multiple select blocks
c = c.replace(
    '      user_auth: {\n          select: {\n            transaction_pin_hash: true,\n            transaction_pin_failed_attempts: true,\n            transaction_pin_locked_until: true,\n            transaction_pin_hard_locked: true,\n            transaction_pin_lockout_count: true,',
    '      auth: {\n          select: {\n            transaction_pin_hash: true,\n            transaction_pin_failed_attempts: true,\n            transaction_pin_locked_until: true,\n            transaction_pin_hard_locked: true,\n            transaction_pin_lockout_count: true,'
)

# Fix the UID sender load — upp fields
c = c.replace(
    '      user_auth: {\n        select: {\n          upp_hash:             true,\n          upp_failed_attempts:  true,\n          upp_locked_until:     true,\n          upp_hard_locked:      true,\n          upp_lockout_count:    true,',
    '      auth: {\n        select: {\n          upp_hash:             true,\n          upp_failed_attempts:  true,\n          upp_locked_until:     true,\n          upp_hard_locked:      true,\n          upp_lockout_count:    true,'
)

# Fix all .user_auth? and .user_auth. access patterns
c = c.replace('.user_auth?.transaction_pin_hash', '.auth?.transaction_pin_hash')
c = c.replace('.user_auth?.upp_hash', '.auth?.upp_hash')
c = c.replace('const senderAuth     = senderData.user_auth;', 'const senderAuth     = senderData.auth;')
c = c.replace('const auth           = sender.user_auth;', 'const auth           = sender.auth;')
c = c.replace('auth:     user.user_auth,', 'auth:     user.auth,')

# Fix the user type cast that references user_auth
c = c.replace(
    '    user_auth: {\n      upp_hash: string | null;\n      upp_failed_attempts: number;\n      upp_locked_until: Date | null;\n      upp_hard_locked: boolean;\n      upp_lockout_count: number;\n    } | null;',
    '    auth: {\n      upp_hash: string | null;\n      upp_failed_attempts: number;\n      upp_locked_until: Date | null;\n      upp_hard_locked: boolean;\n      upp_lockout_count: number;\n    } | null;'
)

with open('src/features/transfers/transfers.service.ts', 'w') as f:
    f.write(c)
print("done")
