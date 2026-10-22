import csv, sys
term = sys.argv[1]
books = sys.argv[2:] if len(sys.argv) > 2 else None
with open('.scratch/t36/leaves.tsv', encoding='utf-8') as f:
    for row in csv.reader(f, delimiter='\t'):
        book, kid, num, name, page, depth = row
        if term not in name:
            continue
        if books and book not in books:
            continue
        print(f'{book}\t{kid}\t{num}\t{name}\tp{page}\td{depth}')
