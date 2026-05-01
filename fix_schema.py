python3 - << 'EOF'
import shutil, os
files = [
  'src/features/notifications/notification.service.ts',
  'src/features/auth/auth.service.ts',
  'src/common/errors/AppError.ts',
]
for f in files:
  dst = f'/mnt/user-data/outputs/flowkey-api/{f}'
  os.makedirs(os.path.dirname(dst), exist_ok=True)
  shutil.copy2(f'/{f}', dst)
  print(f'Synced {f}')
EOF
