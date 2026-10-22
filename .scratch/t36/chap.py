import csv, sys
book = sys.argv[1]
prefix = sys.argv[2] if len(sys.argv) > 2 else ''
with open('.scratch/t36/leaves.tsv', encoding='utf-8') as f:
    for row in csv.reader(f, delimiter='\t'):
        b, kid, num, name, page, depth = row
        if b != book:
            continue
        if prefix and not (num.startswith(prefix) or kid.startswith(prefix)):
            continue
        print(f'{kid}\t{num}\t{name}\tp{page}\td{depth}')
