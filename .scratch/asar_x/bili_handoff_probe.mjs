
const id = process.argv[2] || 'session-55c776d2-6df9-450c-abcf-db3fe6001ef9';
const r = await fetch('http://127.0.0.1:18788/__bili/sessions/' + encodeURIComponent(id) + '/detail');
console.log('status', r.status);
const j = await r.json();
console.log('keys', Object.keys(j).join(','));
const md = j.handoffMd || '';
console.log('handoffMd chars', md.length, 'truncated', j.handoffTruncated, 'html chars', (j.handoffHtml||'').length);
const heads = md.split('\n').filter(l => l.startsWith('#')).slice(0, 30);
console.log('headings:', JSON.stringify(heads));
console.log('--- first 1200 ---');
console.log(md.slice(0, 1200));
