import re
with open('client/src/data/services.ts', encoding='utf-8') as f:
    t = f.read()
chunks = re.split(r'\n  \{\n    id:', t)
for c in chunks[1:8]:
    idm = re.search(r'^\s*"([^"]+)"', c)
    title = re.search(r'title:\s*"([^"]+)"', c)
    cat = re.search(r'category:\s*"([^"]+)"', c)
    desc = re.search(r'description:\s*"([^"]+)"', c)
    pr = re.search(r'(Typical range:.*?")', c)
    print((idm.group(1) if idm else '?'), '|',
          (title.group(1) if title else '?'), '|',
          (cat.group(1) if cat else '?'), '|',
          (desc.group(1) if desc else '?')[:60], '|',
          (pr.group(1).rstrip('"') if pr else '?')[:60])