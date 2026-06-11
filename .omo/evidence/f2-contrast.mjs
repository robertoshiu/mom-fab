function hexToRgb(h){h=h.replace('#','');if(h.length===3)h=h.split('').map(c=>c+c).join('');return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];}
function lin(c){c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);}
function lum([r,g,b]){return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);}
function ratio(f,b){const L1=lum(hexToRgb(f)),L2=lum(hexToRgb(b));const a=Math.max(L1,L2),d=Math.min(L1,L2);return (a+0.05)/(d+0.05);}
function check(name,f,b){const r=ratio(f,b);const ok=r>=4.5;console.log(`${ok?'PASS':'FAIL'} ${r.toFixed(2)}  ${name}`);return ok;}

console.log('=== DARK ===');
const dark={bgP:'#0a1428',bgE:'#142840',bgI:'#081020',tP:'#e8f1ff',tS:'#8fa8c7',accent:'#00d4ff',success:'#3ddc97',warn:'#ffb547',danger:'#ff4d6d',idle:'#5a6f8a'};
let dpass=true,dn=0;
[['text-primary/bg-primary',dark.tP,dark.bgP],['text-primary/bg-elevated',dark.tP,dark.bgE],['text-primary/bg-inset',dark.tP,dark.bgI],['text-secondary/bg-primary',dark.tS,dark.bgP],['text-secondary/bg-elevated',dark.tS,dark.bgE],['accent/bg-primary',dark.accent,dark.bgP],['accent/bg-elevated',dark.accent,dark.bgE],['warn/bg-primary',dark.warn,dark.bgP],['warn/bg-elevated',dark.warn,dark.bgE],['danger/bg-primary',dark.danger,dark.bgP],['danger/bg-elevated',dark.danger,dark.bgE],['success/bg-primary',dark.success,dark.bgP],['success/bg-elevated',dark.success,dark.bgE]].forEach(([n,f,b])=>{if(!check(n,f,b))dpass=false;dn++;});
console.log(`dark: ${dn} pairs, ${dpass?'ALL PASS':'SOME FAIL'}`);

console.log('=== LIGHT ===');
const light={bgP:'#f8fafc',bgE:'#ffffff',bgI:'#eef2f7',tP:'#1a2332',tS:'#51647e',accent:'#0066cc',success:'#077048',warn:'#985700',danger:'#c81e4a',idle:'#6c7f96'};
let lpass=true,ln=0;
[['text-primary/bg-primary',light.tP,light.bgP],['text-primary/bg-elevated',light.tP,light.bgE],['text-primary/bg-inset',light.tP,light.bgI],['text-secondary/bg-primary',light.tS,light.bgP],['text-secondary/bg-elevated',light.tS,light.bgE],['text-secondary/bg-inset',light.tS,light.bgI],['accent/bg-primary',light.accent,light.bgP],['accent/bg-elevated',light.accent,light.bgE],['warn/bg-primary',light.warn,light.bgP],['warn/bg-inset',light.warn,light.bgI],['danger/bg-primary',light.danger,light.bgP],['danger/bg-elevated',light.danger,light.bgE],['success/bg-primary',light.success,light.bgP],['success/bg-inset',light.success,light.bgI]].forEach(([n,f,b])=>{if(!check(n,f,b))lpass=false;ln++;});
console.log(`light: ${ln} pairs, ${lpass?'ALL PASS':'SOME FAIL'}`);
