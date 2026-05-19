with open('src/config/index.ts', 'r') as f:
    c = f.read()

# Remove from AppConfig interface
c = c.replace(
    """  // KYC — per-tier transfer limits (kobo)
  kycTier0DailyLimit: bigint;   // unverified — no transfers
  kycTier1DailyLimit: bigint;   // BVN verified
  kycTier2DailyLimit: bigint;   // NIN + selfie
  kycTier3DailyLimit: bigint;   // address + docs
  kycTier1SingleLimit: bigint;
  kycTier2SingleLimit: bigint;
  kycTier3SingleLimit: bigint;
  kycCooldownTier1Hours: number;
  kycCooldownTier2PlusHours: number;""",
    """  // KYC — cooldown hours between upgrade attempts
  // Transfer limits are defined in src/features/kyc/kyc.types.ts (TIER_LIMITS)
  // and are NOT sourced from config to avoid mismatch.
  kycCooldownTier1Hours: number;
  kycCooldownTier2PlusHours: number;"""
)

# Remove from buildConfig
c = c.replace(
    """    // KYC — per-tier transfer limits (kobo)
    // Tier 0: no transfers until BVN verified
    // Tier 1 (BVN): ₦50k/day, ₦20k single
    // Tier 2 (NIN+selfie): ₦500k/day, ₦200k single
    // Tier 3 (address+docs): ₦5m/day, ₦2m single
    kycTier0DailyLimit: BigInt(process.env['KYC_TIER0_DAILY_LIMIT'] ?? '0'),
    kycTier1DailyLimit: BigInt(process.env['KYC_TIER1_DAILY_LIMIT'] ?? '5000000'),
    kycTier2DailyLimit: BigInt(process.env['KYC_TIER2_DAILY_LIMIT'] ?? '50000000'),
    kycTier3DailyLimit: BigInt(process.env['KYC_TIER3_DAILY_LIMIT'] ?? '500000000'),
    kycTier1SingleLimit: BigInt(process.env['KYC_TIER1_SINGLE_LIMIT'] ?? '2000000'),
    kycTier2SingleLimit: BigInt(process.env['KYC_TIER2_SINGLE_LIMIT'] ?? '20000000'),
    kycTier3SingleLimit: BigInt(process.env['KYC_TIER3_SINGLE_LIMIT'] ?? '200000000'),
    kycCooldownTier1Hours: envInt('KYC_COOLDOWN_TIER1_HOURS', 24),
    kycCooldownTier2PlusHours: envInt('KYC_COOLDOWN_TIER2PLUS_HOURS', 48),""",
    """    // KYC — cooldown hours between upgrade attempts
    // Transfer limits live in src/features/kyc/kyc.types.ts — not in config
    kycCooldownTier1Hours:    envInt('KYC_COOLDOWN_TIER1_HOURS',      24),
    kycCooldownTier2PlusHours: envInt('KYC_COOLDOWN_TIER2PLUS_HOURS', 48),"""
)

with open('src/config/index.ts', 'w') as f:
    f.write(c)
print("done")
