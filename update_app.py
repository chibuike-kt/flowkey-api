with open('src/features/transfers/transfers.service.ts', 'r') as f:
    c = f.read()

# Update executeUidInternalTransfer signature and audit log
c = c.replace(
    "export async function executeUidInternalTransfer(\n  input:          UidInternalTransferInput,\n  idempotencyKey: string,\n): Promise<InternalTransferResult> {",
    "export async function executeUidInternalTransfer(\n  input:          UidInternalTransferInput,\n  idempotencyKey: string,\n  deviceUserId:   string,  // the friend's user ID — for audit only\n): Promise<InternalTransferResult> {"
)

# Update audit log inside executeUidInternalTransfer to include device context
c = c.replace(
    "        metadata: {\n          universal_id:        input.universal_id,\n          sender_wallet_id:    sender.walletId,\n          receiver_wallet_id:  input.recipient_wallet_id,\n          amount_kobo:         amountKobo.toString(),\n          auth_method:         'upp',\n          reference,\n        },\n      },\n    });\n\n    return row as {\n      id: string; amount: bigint; fee: bigint; net_amount: bigint;\n      narration: string | null; reference: string;\n      sender_wallet_id: string; receiver_wallet_id: string; created_at: Date;\n    };\n  }, { isolationLevel: 'Serializable' });\n\n  transfersTotal.inc({ type: 'internal', status: 'completed' });\n  logger.info('UID internal transfer completed',",
    "        metadata: {\n          universal_id:        input.universal_id,\n          sender_wallet_id:    sender.walletId,\n          receiver_wallet_id:  input.recipient_wallet_id,\n          amount_kobo:         amountKobo.toString(),\n          auth_method:         'upp',\n          device_user_id:      deviceUserId,  // friend's account — device context\n          reference,\n        },\n      },\n    });\n\n    return row as {\n      id: string; amount: bigint; fee: bigint; net_amount: bigint;\n      narration: string | null; reference: string;\n      sender_wallet_id: string; receiver_wallet_id: string; created_at: Date;\n    };\n  }, { isolationLevel: 'Serializable' });\n\n  transfersTotal.inc({ type: 'internal', status: 'completed' });\n  logger.info('UID internal transfer completed',"
)

# Update executeUidBankTransfer signature
c = c.replace(
    "export async function executeUidBankTransfer(\n  input:          UidBankTransferInput,\n  idempotencyKey: string,\n): Promise<BankTransferResult> {",
    "export async function executeUidBankTransfer(\n  input:          UidBankTransferInput,\n  idempotencyKey: string,\n  deviceUserId:   string,  // the friend's user ID — for audit only\n): Promise<BankTransferResult> {"
)

# Update bank transfer audit log to include device context
c = c.replace(
    "          universal_id:     input.universal_id,\n          sender_wallet_id: sender.walletId,\n          amount_kobo:      amountKobo.toString(),\n          fee_kobo:         fee.toString(),\n          bank_code:        input.bank_code,\n          account_last4:    input.account_number.slice(-4),\n          auth_method:      'upp',\n          reference,",
    "          universal_id:     input.universal_id,\n          sender_wallet_id: sender.walletId,\n          amount_kobo:      amountKobo.toString(),\n          fee_kobo:         fee.toString(),\n          bank_code:        input.bank_code,\n          account_last4:    input.account_number.slice(-4),\n          auth_method:      'upp',\n          device_user_id:   deviceUserId,  // friend's account — device context\n          reference,"
)

with open('src/features/transfers/transfers.service.ts', 'w') as f:
    f.write(c)
print("service updated")
