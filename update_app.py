files = [
    'src/features/deposits/deposits.service.ts',
    'src/features/transfers/transfers.service.ts',
]

for path in files:
    with open(path, 'r') as f:
        c = f.read()
    c = c.replace(
        "initiator_id:       '00000000-0000-0000-0000-000000000000',",
        "initiator_id:       null,"
    )
    with open(path, 'w') as f:
        f.write(c)
    print(f"  fixed: {path.split('/')[-1]}")
